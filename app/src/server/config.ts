import { Config, Context, Effect, Layer, Redacted } from 'effect'

export type QuestMode = 'pomerium' | 'simulated'

export class QuestConfig extends Context.Service<
  QuestConfig,
  {
    /** pomerium: requests must carry a valid Pomerium JWT. simulated: local dev without Pomerium. */
    readonly mode: QuestMode
    /** Public origin of the game route, e.g. https://game.localhost.pomerium.io */
    readonly publicOrigin: string
    /** In-cluster address of the Oracle's admin API. */
    readonly oracleAdminUrl: string
    readonly oracleAdminKey: Redacted.Redacted<string>
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
    const oracleAdminUrl = yield* Config.String('ORACLE_ADMIN_URL').pipe(
      Config.withDefault('http://localhost:4000'),
    )
    const oracleAdminKey = yield* Config.Redacted('ORACLE_ADMIN_KEY').pipe(
      Config.withDefault(Redacted.make('dev-only-oracle-key')),
    )
    return { mode, publicOrigin, oracleAdminUrl, oracleAdminKey }
  }),
)
