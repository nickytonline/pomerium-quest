import { Effect } from 'effect'
import { SIGNED_IN_MESSAGE, ZONES } from '../game/zones.ts'
import { QuestConfig } from './config.ts'
import { PomeriumIdentity, type Player } from './identity.ts'
import { OracleAdmin } from './oracle-admin.ts'
import { json } from './runtime.ts'

// Upstream handlers for every Pomerium route under /zones. By the time a request gets
// here Pomerium has already allowed it; these handlers only check that it really came
// through Pomerium (signed JWT) and answer as the place in the game world.

const currentPlayer = (request: Request) =>
  Effect.gen(function* () {
    const identity = yield* PomeriumIdentity

    return yield* identity.verify(request)
  })

/** The end of a sign-in that ran in the game's frame: tell the game, which closes the frame. */
const signedInFrame = (origin: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Signed in</title><script>parent.postMessage(${JSON.stringify(SIGNED_IN_MESSAGE)}, ${JSON.stringify(origin)})</script>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )

const greeting = (zoneName: string, player: Player) => `${zoneName} welcomes ${player.email}.`

export const handleZone = (request: Request, splat: string) =>
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const [zoneId = '', ...rest] = splat.split('/')
    const action = rest.join('/')
    const zone = ZONES.find((candidate) => candidate.id === zoneId)

    if (!zone) return json(404, { error: 'unknown zone', path: splat })

    const player = yield* currentPlayer(request)
    const verifiedBy = 'pomerium-jwt'

    switch (`${request.method} ${zone.id}/${action}`) {
      case 'GET oracle/':
        return json(200, { player })
      case 'GET oracle/signin':
        // Pomerium redirects back here after sign-in, inside the game's frame or as a full page.
        return request.headers.get('sec-fetch-dest') === 'iframe'
          ? signedInFrame(new URL(config.publicOrigin).origin)
          : Response.redirect(new URL('/?signedin=1', config.publicOrigin), 302)
      case 'POST guild/knight': {
        const oracle = yield* OracleAdmin
        yield* oracle.grant(player.email, 'knights')

        return json(200, { granted: 'knights', refreshRequired: true, verifiedBy })
      }

      // The Librarian writes to the Oracle, like the Captain, once the player has read every book.
      case 'POST oracle/scholar': {
        const oracle = yield* OracleAdmin
        yield* oracle.grant(player.email, 'scholars')

        return json(200, { granted: 'scholars', refreshRequired: true, verifiedBy })
      }

      case 'POST scriptorium/ledger':
        return json(200, { written: true, verifiedBy })
      default:
        return json(200, {
          zone: zone.id,
          message: greeting(zone.name, player),
          servedTo: player.email,
          verifiedBy,
        })
    }
  }).pipe(
    Effect.catchTags({
      // 421 Misdirected Request, not 401: signing in can't fix a request that skipped Pomerium.
      MissingAssertion: () =>
        Effect.succeed(json(421, { error: 'no Pomerium JWT: this request did not come through Pomerium' })),
      InvalidAssertion: (error) =>
        Effect.succeed(json(401, { error: 'invalid Pomerium JWT', reason: error.reason })),
      OracleUnavailable: (error) =>
        Effect.succeed(json(502, { error: 'the Oracle is unreachable', reason: error.reason })),
    }),
  )
