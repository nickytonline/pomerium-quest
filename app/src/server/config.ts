import { Config, Context, Effect, Layer, Redacted } from 'effect'

export type QuestMode = 'pomerium' | 'simulated'

export class QuestConfig extends Context.Service<
  QuestConfig,
  {
    /** pomerium: requests must carry a valid Pomerium JWT. simulated: local dev without Pomerium. */
    readonly mode: QuestMode
    /** Public origin of the game route, e.g. https://game.localhost.pomerium.io */
    readonly publicOrigin: string
    /** In-cluster address of Keycloak (the Oracle), for its admin API. */
    readonly keycloakUrl: string
    readonly keycloakRealm: string
    /** The game's own Keycloak client, whose service account may add players to groups. */
    readonly keycloakClientId: string
    readonly keycloakClientSecret: Redacted.Redacted<string>
  }
>()('QuestConfig') {}

export const QuestConfigLive = Layer.effect(
  QuestConfig,
  Effect.gen(function* () {
    const mode = yield* Config.Literals(['pomerium', 'simulated'], 'QUEST_MODE').pipe(
      Config.withDefault('simulated'),
    )

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

    return { mode, publicOrigin, keycloakUrl, keycloakRealm, keycloakClientId, keycloakClientSecret }
  }),
)
