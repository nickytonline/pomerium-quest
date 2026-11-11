import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import {
  VISITORS,
  VISITOR_IDS,
  visitorPassword,
  type Knock,
  type Knocker,
  type Visitor,
  type VisitorId,
} from '../game/house.ts'
import { FALCONER, type OwlCall, type OwlFlight } from '../game/perch.ts'
import { QuestConfig } from './config.ts'
import { VisitorLost } from './errors.ts'

// The townsfolk who knock on players' houses. Each has a real account at the Oracle (./quest imports
// them at deploy) and signs in through Pomerium like a player, so every knock is a real request that
// Pomerium allows or refuses. A slime bot is the same request with no session at all. The Falconer has an
// account too, and sends an owl of their own from the perch.

/** Who can sign in from here: a house's visitor, or the Falconer. */
type TownspersonId = VisitorId | 'falconer'

const TOWNSFOLK: Record<TownspersonId, Visitor> = { ...VISITORS, falconer: FALCONER }

/** The perch's own address on the game's host: a request there gets a token for whoever is signed in. */
const PERCH_PATH = '/zones/perch/aviary'

/** The perch's own flight gives up after 15 seconds (see perch.ts), so this waits a little longer. */
const PERCH_TIMEOUT_MS = 20_000

/** How long to wait for Pomerium to start enforcing a house's latest rules. */
const PICKUP_MS = 45_000

const HouseAnswer = Schema.Struct({ version: Schema.NullOr(Schema.String) })

/** A browser's cookies, kept per host: Pomerium, its authenticate service and the Oracle each set some. */
class CookieJar {
  private readonly byHost = new Map<string, Map<string, string>>()

  header(url: URL) {
    const cookies = this.byHost.get(url.host)

    return cookies ? [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') : ''
  }

  store(url: URL, response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';')
      const at = pair.indexOf('=')
      const cookies = this.byHost.get(url.host) ?? new Map<string, string>()
      cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim())
      this.byHost.set(url.host, cookies)
    }
  }
}

/** The first form on a page: its action, with HTML entities undone. */
const formAction = (html: string) =>
  /<form[^>]*action="([^"]*)"/.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? null

export class Visitors extends Context.Service<
  Visitors,
  {
    /** Knocks on a house, as a townsperson or a slime, once Pomerium enforces `version`. */
    readonly knock: (
      path: string,
      knocker: Knocker,
      method: 'GET' | 'POST',
      version: string,
    ) => Effect.Effect<Knock, VisitorLost>
    /** Sends the Falconer's owl from the perch, on the Falconer's behalf: the same route a player's owl takes. */
    readonly sendFalconersOwl: (call: OwlCall) => Effect.Effect<OwlFlight, VisitorLost>
  }
>()('Visitors') {}

export const VisitorsLive = Layer.effect(
  Visitors,
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const origin = new URL(config.publicOrigin)
    const jars = new Map<TownspersonId, CookieJar>()

    /** Follows redirects by hand, as a browser would, keeping cookies along the way. */
    const visit = (jar: CookieJar, start: URL, init: { method?: string; body?: URLSearchParams } = {}) =>
      Effect.tryPromise({
        try: async () => {
          let url = start
          let method = init.method ?? 'GET'
          let body = init.body

          for (let hop = 0; hop < 15; hop++) {
            const response = await fetch(url, {
              method,
              body: body ?? null,
              redirect: 'manual',
              headers: { cookie: jar.header(url), accept: 'text/html' },
            })

            jar.store(url, response)
            const location = response.headers.get('location')

            if (!location || response.status < 300 || response.status >= 400)
              return { url, status: response.status, text: await response.text() }

            url = new URL(location, url)
            method = 'GET'
            body = undefined
          }

          throw new Error('too many redirects')
        },
        catch: (cause) => new VisitorLost({ reason: String(cause) }),
      })

    /** Signs a townsperson in through Pomerium and the Oracle, the way a browser does. */
    const signIn = (id: TownspersonId) =>
      Effect.gen(function* () {
        const visitor = TOWNSFOLK[id]
        const password = visitorPassword(Redacted.value(config.visitorPassword), id)

        const jar = new CookieJar()
        const page = yield* visit(jar, new URL('/zones/oracle/signin', origin))
        const action = formAction(page.text)

        if (!action) return yield* new VisitorLost({ reason: `no sign-in form for ${visitor.email}` })

        yield* visit(jar, new URL(action, page.url), {
          method: 'POST',
          body: new URLSearchParams({ username: visitor.email, password }),
        })

        jars.set(id, jar)

        return jar
      })

    const sessionOf = (id: TownspersonId) => {
      const jar = jars.get(id)

      return jar ? Effect.succeed(jar) : signIn(id)
    }

    /** One knock: Pomerium's status, and the rules version the house saw when Pomerium let it through. */
    const once = (url: URL, jar: CookieJar, method: 'GET' | 'POST') =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, {
            method,
            redirect: 'manual',
            headers: { cookie: jar.header(url), accept: 'application/json' },
          })

          const answer =
            response.status === 200 ? Schema.decodeUnknownOption(HouseAnswer)(await response.json()) : null

          return { status: response.status, version: answer?._tag === 'Some' ? answer.value.version : null }
        },
        catch: (cause) => new VisitorLost({ reason: String(cause) }),
      })

    const knock = (path: string, knocker: Knocker, method: 'GET' | 'POST', version: string) =>
      Effect.gen(function* () {
        const url = new URL(`${path}knock`, origin)
        let jar = knocker === 'slime' ? new CookieJar() : yield* sessionOf(knocker)
        let signedInAgain = false
        const started = Date.now()

        // Pomerium takes a moment to pick up a saved house. Until then a knock can be answered by the
        // old rules (an older version) or by no route at all (404), so knock again.
        for (;;) {
          const result = yield* once(url, jar, method)

          // A lost session (Pomerium restarted, or it expired) means signing in again, once.
          if (knocker !== 'slime' && result.status === 401 && !signedInAgain) {
            signedInAgain = true
            jar = yield* signIn(knocker)

            continue
          }

          const current = result.status === 200 ? result.version === version : result.status !== 404

          if (current || Date.now() - started > PICKUP_MS)
            return { knocker, method, status: result.status, version: result.version }

          yield* Effect.sleep('1 second')
        }
      })

    /** One request to the perch as the Falconer: the status, and the flight the game's server reports. */
    const perch = (jar: CookieJar, call: OwlCall) => {
      const url = new URL(PERCH_PATH, origin)

      return Effect.tryPromise({
        try: async () => {
          const response = await fetch(url, {
            method: 'POST',
            redirect: 'manual',
            signal: AbortSignal.timeout(PERCH_TIMEOUT_MS),
            headers: {
              cookie: jar.header(url),
              accept: 'application/json',
              'content-type': 'application/json',
            },
            body: JSON.stringify(call),
          })

          // SAFETY: a 200 from the perch's route is this server's own answer there, which is always an OwlFlight.
          const flight = response.status === 200 ? ((await response.json()) as OwlFlight) : null

          return { status: response.status, flight }
        },
        catch: (cause) => new VisitorLost({ reason: String(cause) }),
      })
    }

    const sendFalconersOwl = (call: OwlCall) =>
      Effect.gen(function* () {
        let sent = yield* perch(yield* sessionOf('falconer'), call)

        // A lost session (Pomerium restarted, or it expired) means signing in again, once.
        if (sent.status === 401) sent = yield* perch(yield* signIn('falconer'), call)

        if (!sent.flight)
          return yield* new VisitorLost({ reason: `the perch answered the Falconer with ${sent.status}` })

        return sent.flight
      })

    // Sign everyone in up front, so the first visit is quick. A failure here is retried on
    // the first knock.
    yield* Effect.forEach([...VISITOR_IDS, 'falconer' as const], (id) => Effect.ignore(signIn(id)), {
      discard: true,
    }).pipe(Effect.forkDetach)

    return { knock, sendFalconersOwl }
  }),
)
