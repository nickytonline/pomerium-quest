import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { QuestConfig } from './config.ts'
import { OracleUnavailable } from './errors.ts'

// The game asks the Oracle (Keycloak, our identity provider) to add a group or a claim to a player.
// Pomerium only sees the change once the player's session is refreshed with new claims.
export class OracleAdmin extends Context.Service<
  OracleAdmin,
  {
    readonly grant: (email: string, group: string) => Effect.Effect<void, OracleUnavailable>
    /** Sets a claim on the player, as a user attribute the Oracle puts in their token: the deed, say. */
    readonly setClaim: (email: string, claim: string, value: string) => Effect.Effect<void, OracleUnavailable>
  }
>()('OracleAdmin') {}

const TokenResponse = Schema.Struct({ access_token: Schema.String })
const Found = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) }))

// A user as Keycloak returns it. Updating a user sends the whole record back, so it's kept as it came.
const UserRecord = Schema.Record(Schema.String, Schema.Unknown)

const UserIdentity = Schema.Struct({
  id: Schema.String,
  attributes: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
})

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

    const setClaim = (email: string, claim: string, value: string) =>
      Effect.gen(function* () {
        const accessToken = yield* token

        const users = yield* HttpClientRequest.get(`${adminUrl}/users`).pipe(
          HttpClientRequest.setUrlParams({ email, exact: 'true' }),
          HttpClientRequest.bearerToken(accessToken),
          client.execute,
          Effect.flatMap(readJson(Schema.Array(UserRecord))),
        )

        const [user] = users

        if (!user) return yield* new OracleUnavailable({ reason: `no user for ${email}` })

        const { id, attributes } = yield* Schema.decodeUnknownEffect(UserIdentity)(user)

        yield* HttpClientRequest.put(`${adminUrl}/users/${id}`).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.bodyJsonUnsafe({ ...user, attributes: { ...attributes, [claim]: [value] } }),
          client.execute,
        )

        // Keycloak answers 204 even when it drops an attribute the user profile doesn't declare (a realm
        // from before the deed), so read it back rather than tell the player it's theirs.
        const stored = yield* HttpClientRequest.get(`${adminUrl}/users/${id}`).pipe(
          HttpClientRequest.bearerToken(accessToken),
          client.execute,
          Effect.flatMap(readJson(UserIdentity)),
        )

        if (stored.attributes?.[claim]?.[0] !== value) {
          return yield* new OracleUnavailable({
            reason: `the Oracle didn't keep the ${claim} claim; run ./quest deploy`,
          })
        }
      }).pipe(
        Effect.mapError((error) =>
          error instanceof OracleUnavailable ? error : new OracleUnavailable({ reason: String(error) }),
        ),
      )

    return { grant, setClaim }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
