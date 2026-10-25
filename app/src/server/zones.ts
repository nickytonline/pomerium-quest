import { Effect } from 'effect'
import { ZONES } from '../game/zones.ts'
import { QuestConfig } from './config.ts'
import { PomeriumIdentity, type Player } from './identity.ts'
import { OracleAdmin } from './oracle-admin.ts'
import { json } from './runtime.ts'

// Upstream handlers for every Pomerium route under /zones. By the time a request gets
// here Pomerium has already allowed it; these handlers only check that it really came
// through Pomerium (signed JWT) and answer as the place in the game world.

const currentPlayer = (request: Request) =>
  Effect.gen(function* () {
    const config = yield* QuestConfig

    if (config.mode === 'simulated') return undefined
    const identity = yield* PomeriumIdentity

    return yield* identity.verify(request)
  })

const greeting = (zoneName: string, player: Player | undefined) =>
  player ? `${zoneName} welcomes ${player.email}.` : `${zoneName} welcomes you (simulated mode).`

export const handleZone = (request: Request, splat: string) =>
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const [zoneId = '', ...rest] = splat.split('/')
    const action = rest.join('/')
    const zone = ZONES.find((candidate) => candidate.id === zoneId)

    if (!zone) return json(404, { error: 'unknown zone', path: splat })

    const player = yield* currentPlayer(request)
    const verifiedBy = player ? 'pomerium-jwt' : 'none (simulated)'

    switch (`${request.method} ${zone.id}/${action}`) {
      case 'GET oracle/':
        return json(200, { mode: config.mode, player: player ?? null })
      case 'GET oracle/signin':
        return Response.redirect(new URL('/?signedin=1', config.publicOrigin), 302)
      case 'POST guild/knight': {
        if (player) {
          const oracle = yield* OracleAdmin
          yield* oracle.grant(player.email, 'knights')
        }

        return json(200, { granted: 'knights', refreshRequired: Boolean(player), verifiedBy })
      }

      case 'POST library/ledger':
        return json(200, { written: true, verifiedBy })
      default:
        return json(200, {
          zone: zone.id,
          message: greeting(zone.name, player),
          servedTo: player?.email ?? null,
          verifiedBy,
        })
    }
  }).pipe(
    Effect.catchTags({
      MissingAssertion: () =>
        Effect.succeed(json(401, { error: 'no Pomerium JWT: this request did not come through Pomerium' })),
      InvalidAssertion: (error) =>
        Effect.succeed(json(401, { error: 'invalid Pomerium JWT', reason: error.reason })),
      OracleUnavailable: (error) =>
        Effect.succeed(json(502, { error: 'the Oracle is unreachable', reason: error.reason })),
    }),
  )
