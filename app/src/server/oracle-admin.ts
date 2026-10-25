import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { QuestConfig } from './config.ts'
import { OracleUnavailable } from './errors.ts'

// The game asks the Oracle (Keycloak, our identity provider) to add a group to a player.
// Pomerium only sees the change once the player's session is refreshed with new claims.
export class OracleAdmin extends Context.Service<
  OracleAdmin,
  {
    readonly grant: (email: string, group: string) => Effect.Effect<void, OracleUnavailable>
  }
>()('OracleAdmin') {}

const TokenResponse = Schema.Struct({ access_token: Schema.String })
const Found = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) }))

export const OracleAdminLive = Layer.effect(
  OracleAdmin,
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const realmUrl = `${config.keycloakUrl}/realms/${config.keycloakRealm}`
    const adminUrl = `${config.keycloakUrl}/admin/realms/${config.keycloakRealm}`

    const readJson =
      <S extends Schema.Top>(schema: S) =>
      (response: HttpClientResponse.HttpClientResponse) =>
        response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(schema)))

    // The game signs in to Keycloak as its own service account, which may only manage users.
    const token = HttpClientRequest.post(`${realmUrl}/protocol/openid-connect/token`).pipe(
      HttpClientRequest.bodyUrlParams({
        grant_type: 'client_credentials',
        client_id: config.keycloakClientId,
        client_secret: Redacted.value(config.keycloakClientSecret),
      }),
      client.execute,
      Effect.flatMap(readJson(TokenResponse)),
      Effect.map((body) => body.access_token),
    )

    const find = (path: string, params: Record<string, string>, accessToken: string) =>
      HttpClientRequest.get(`${adminUrl}/${path}`).pipe(
        HttpClientRequest.setUrlParams(params),
        HttpClientRequest.bearerToken(accessToken),
        client.execute,
        Effect.flatMap(readJson(Found)),
      )

    const grant = (email: string, group: string) =>
      Effect.gen(function* () {
        const accessToken = yield* token
        const [user] = yield* find('users', { email, exact: 'true' }, accessToken)
        const groups = yield* find('groups', { search: group, exact: 'true' }, accessToken)
        const found = groups.find((candidate) => candidate.name === group)

        if (!user || !found) {
          return yield* new OracleUnavailable({
            reason: `no ${user ? 'group' : 'user'} for ${email} / ${group}`,
          })
        }

        yield* HttpClientRequest.put(`${adminUrl}/users/${user.id}/groups/${found.id}`).pipe(
          HttpClientRequest.bearerToken(accessToken),
          client.execute,
        )
      }).pipe(
        Effect.mapError((error) =>
          error instanceof OracleUnavailable ? error : new OracleUnavailable({ reason: error.message }),
        ),
      )

    return { grant }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
