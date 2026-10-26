import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import {
  VISITORS,
  VISITOR_IDS,
  visitorPassword,
  type Knock,
  type Knocker,
  type VisitorId,
} from '../game/house.ts'
import { QuestConfig } from './config.ts'
import { VisitorLost } from './errors.ts'

// The townsfolk who knock on players' houses. Each has a real account at the Oracle (./quest imports
// them at deploy) and signs in through Pomerium like a player, so every knock is a real request that
// Pomerium allows or refuses. A slime bot is the same request with no session at all.

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
  }
>()('Visitors') {}

export const VisitorsLive = Layer.effect(
  Visitors,
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const origin = new URL(config.publicOrigin)
    const jars = new Map<VisitorId, CookieJar>()

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
    const signIn = (id: VisitorId) =>
      Effect.gen(function* () {
        const visitor = VISITORS[id]
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

    const sessionOf = (id: VisitorId) => {
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

    // Sign everyone in up front, so the first visit is quick. A failure here is retried on
    // the first knock.
    yield* Effect.forEach(VISITOR_IDS, (id) => Effect.ignore(signIn(id)), { discard: true }).pipe(
      Effect.forkDetach,
    )

    return { knock }
  }),
)
