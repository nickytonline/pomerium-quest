import { Effect, Schema } from 'effect'
import { GROUPS } from '../game/groups.ts'
import { turnsAwayOwner, type HouseRule } from '../game/house.ts'
import { SIGNED_IN_MESSAGE, ZONES } from '../game/zones.ts'
import { QuestConfig } from './config.ts'
import { InvalidRules } from './errors.ts'
import { HouseRules, Houses } from './houses.ts'
import { Visitors } from './visitors.ts'
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

/** What the editor sends: the player's door rules, or null for a house that hasn't been saved yet. */
const HouseRequest = Schema.Struct({ rules: Schema.NullOr(HouseRules) })

/** Who knocks, and how: a GET looks in through the window, a POST knocks on the door. */
const KnockRequest = Schema.Struct({
  knocker: Schema.Literals(['slime', 'baker', 'traveler', 'captain', 'librarian']),
  method: Schema.Literals(['GET', 'POST']),
})

/** Reads a request's JSON body against a schema; anything else is refused as invalid. */
const readBody =
  <S extends Schema.Top>(schema: S) =>
  (request: Request) =>
    Effect.tryPromise({
      try: () => request.json(),
      catch: () => new InvalidRules({ reason: 'not JSON' }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError((error) =>
        error instanceof InvalidRules ? error : new InvalidRules({ reason: error.message }),
      ),
    )

const readKnock = readBody(KnockRequest)
const readRules = readBody(HouseRequest)

/** Refuses rules whose deny would lock the owner out of their own door, whatever the editor allowed. */
const keepOwnerIn = (player: Player, rules: readonly HouseRule[] | null) =>
  rules &&
  turnsAwayOwner(rules, {
    authenticated: true,
    email: player.email,
    groups: player.groups,
    deed: player.deed ?? undefined,
  })
    ? Effect.fail(new InvalidRules({ reason: 'a deny rule would lock the owner out of their own door' }))
    : Effect.void

/**
 * A house answers whoever Pomerium let in, with the rules version Pomerium enforced (X-House-Version).
 * A public house lets in requests with no session, so a missing identity is an anonymous visitor.
 */
const answerHouse = (request: Request, id: string) => {
  const version = request.headers.get('x-house-version')

  // Only a house's own route sets X-House-Version. Without it, the request came through the public
  // game route because the house isn't standing, and an answer here would look like an open door.
  if (!version) return Effect.succeed(json(404, { error: 'no house stands here', house: id }))

  return currentPlayer(request).pipe(
    Effect.map((player) => player.email),
    Effect.catchTag('MissingAssertion', () => Effect.succeed(null)),
    Effect.map((visitor) => json(200, { house: id, version, visitor })),
  )
}

/** The zone whose route Pomerium matched: the longest prefix, so the scriptorium wins over the library. */
const zoneAt = (path: string) =>
  ZONES.filter((zone) => path === zone.prefix || path.startsWith(`${zone.prefix}/`)).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  )[0]

export const handleZone = (request: Request, splat: string) =>
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const [zoneId = '', ...rest] = splat.split('/')

    // Houses aren't in ZONES: each is a route the player wrote (see houses.ts).
    if (zoneId === 'home') return yield* answerHouse(request, rest[0] ?? '')

    const zone = zoneAt(`/zones/${splat}`)

    if (!zone) return json(404, { error: 'unknown zone', path: splat })

    const action = `/zones/${splat}`.slice(zone.prefix.length + 1)

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
        yield* oracle.grant(player.email, GROUPS.knights)

        return json(200, { granted: GROUPS.knights, refreshRequired: true, verifiedBy })
      }

      // The Oracle makes a newcomer a citizen and grants the deed to their house: the citizens group, and a deed
      // claim. The deed is fresh each time, so it belongs to this game: a restart takes it back, and becoming a
      // citizen again grants a new one. Only the Oracle's own zone, since a newcomer isn't a citizen yet.
      case 'POST oracle/citizen': {
        const oracle = yield* OracleAdmin
        const deed = crypto.randomUUID()
        yield* oracle.grantCitizen(player.email, deed)

        return json(200, { granted: [GROUPS.citizens], deed, refreshRequired: true, verifiedBy })
      }

      // The Librarian writes to the Oracle, like the Captain, once the player has read every book.
      case 'POST oracle/scholar': {
        const oracle = yield* OracleAdmin
        yield* oracle.grant(player.email, GROUPS.scholars)

        return json(200, { granted: GROUPS.scholars, refreshRequired: true, verifiedBy })
      }

      // A restart or a death takes the player's claims back, so the next sign-in carries none. The deed goes with
      // them: the Oracle grants it again when the player becomes a citizen.
      case 'POST oracle/reset': {
        const oracle = yield* OracleAdmin
        yield* oracle.wipeClaims(player.email)

        return json(200, { cleared: true, verifiedBy })
      }

      // The owner is always the verified player, never something the request says.
      case 'POST builder/open': {
        const houses = yield* Houses
        const { rules } = yield* readRules(request)
        yield* keepOwnerIn(player, rules)

        return json(200, yield* houses.open(player.email, rules, player.deed))
      }

      case 'POST builder/save': {
        const houses = yield* Houses
        const { rules } = yield* readRules(request)

        if (!rules) return json(400, { error: 'a saved house needs its rules' })

        yield* keepOwnerIn(player, rules)

        return json(200, yield* houses.save(player.email, rules, player.deed))
      }

      // Whether Pomerium has taken up the house's latest rules yet.
      case 'POST builder/status': {
        const houses = yield* Houses
        const house = yield* houses.state(player.email)

        return house ? json(200, house) : json(404, { error: 'no house is standing; open it first' })
      }

      case 'POST builder/knock': {
        const houses = yield* Houses
        const visitors = yield* Visitors
        const { knocker, method } = yield* readKnock(request)
        const house = yield* houses.state(player.email)

        if (!house) return json(404, { error: 'no house is standing; open it first' })

        return json(200, yield* visitors.knock(house.path, knocker, method, house.version))
      }

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
      InvalidRules: (error) =>
        Effect.succeed(json(400, { error: 'invalid door rules', reason: error.reason })),
      BuildersBusy: (error) =>
        Effect.succeed(
          Response.json(
            { error: error.reason, retryAfterSeconds: error.retryAfterSeconds },
            { status: 503, headers: { 'retry-after': String(error.retryAfterSeconds) } },
          ),
        ),
      VisitorLost: (error) =>
        Effect.succeed(json(502, { error: 'the visitor got lost', reason: error.reason })),
      KubeUnavailable: (error) =>
        Effect.succeed(json(502, { error: 'the builders are unreachable', reason: error.reason })),
    }),
  )
