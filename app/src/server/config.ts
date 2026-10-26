import { Config, Context, Effect, Layer, Redacted } from 'effect'

export class QuestConfig extends Context.Service<
  QuestConfig,
  {
    /** Public origin of the game route, e.g. https://game.localhost.pomerium.io */
    readonly publicOrigin: string
    /** In-cluster address of Keycloak (the Oracle), for its admin API. */
    readonly keycloakUrl: string
    readonly keycloakRealm: string
    /** The game's own Keycloak client, whose service account may add players to groups. */
    readonly keycloakClientId: string
    readonly keycloakClientSecret: Redacted.Redacted<string>
    /** The namespace the game writes house Ingresses into, and the only one its Role covers. */
    readonly housesNamespace: string
    /** How many houses may stand at once (docs/prd/your-house.md has the load test behind it). */
    readonly houseLimit: number
    /** The start of every townsperson's password at the Oracle; each adds their own name. */
    readonly visitorPassword: Redacted.Redacted<string>
  }
>()('QuestConfig') {}

export const QuestConfigLive = Layer.effect(
  QuestConfig,
  Effect.gen(function* () {
    const publicOrigin = yield* Config.String('QUEST_PUBLIC_ORIGIN').pipe(
      Config.withDefault('http://localhost:3000'),
    )

    const keycloakUrl = yield* Config.String('KEYCLOAK_URL').pipe(Config.withDefault('http://localhost:8080'))
    const keycloakRealm = yield* Config.String('KEYCLOAK_REALM').pipe(Config.withDefault('kingdom'))

    const keycloakClientId = yield* Config.String('KEYCLOAK_CLIENT_ID').pipe(
      Config.withDefault('quest-admin'),
    )

    const keycloakClientSecret = yield* Config.Redacted('KEYCLOAK_CLIENT_SECRET').pipe(
      Config.withDefault(Redacted.make('dev-only-client-secret')),
    )

    const housesNamespace = yield* Config.String('QUEST_HOUSES_NAMESPACE').pipe(
      Config.withDefault('quest-houses'),
    )

    const houseLimit = yield* Config.Int('QUEST_HOUSE_LIMIT').pipe(Config.withDefault(100))

    const visitorPassword = yield* Config.Redacted('QUEST_VISITOR_PASSWORD').pipe(
      Config.withDefault(Redacted.make('dev-only-visitor-password')),
    )

    return {
      publicOrigin,
      keycloakUrl,
      keycloakRealm,
      keycloakClientId,
      keycloakClientSecret,
      housesNamespace,
      houseLimit,
      visitorPassword,
    }
  }),
)
