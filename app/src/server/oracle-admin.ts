import { Context, Effect, Layer, Redacted } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { QuestConfig } from './config.ts'
import { OracleUnavailable } from './errors.ts'

// The game asks the Oracle (our identity provider) to add a group to a player. Pomerium
// only sees the change once the player's session is refreshed with new claims.
export class OracleAdmin extends Context.Service<
  OracleAdmin,
  {
    readonly grant: (email: string, group: string) => Effect.Effect<void, OracleUnavailable>
  }
>()('OracleAdmin') {}

export const OracleAdminLive = Layer.effect(
  OracleAdmin,
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const client = yield* HttpClient.HttpClient

    const grant = (email: string, group: string) =>
      HttpClientRequest.post(`${config.oracleAdminUrl}/admin/grants`).pipe(
        HttpClientRequest.setHeader('x-oracle-key', Redacted.value(config.oracleAdminKey)),
        HttpClientRequest.bodyUrlParams({ email, group }),
        client.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.asVoid,
        Effect.mapError((error) => new OracleUnavailable({ reason: error.message })),
      )

    return { grant }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
