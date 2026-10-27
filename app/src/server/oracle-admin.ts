import { Context, Effect, Layer, Redacted, Schema } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http'
import { GROUPS, NO_DEED } from '../game/groups.ts'
import { QuestConfig } from './config.ts'
import { OracleUnavailable } from './errors.ts'

// The game asks the Oracle (Keycloak, our identity provider) to add a group or a claim to a player.
// Pomerium only sees the change once the player's session is refreshed with new claims.
export class OracleAdmin extends Context.Service<
  OracleAdmin,
  {
    readonly grant: (email: string, group: string) => Effect.Effect<void, OracleUnavailable>
    /**
     * Makes the player a citizen holding the deed to their house, in one pass. The deed is a user attribute the
     * Oracle puts in their token. It's set first, so a failure leaves them not yet a citizen and the grant is
     * offered again.
     */
    readonly grantCitizen: (email: string, deed: string) => Effect.Effect<void, OracleUnavailable>
    /**
     * Takes back what the Oracle granted: the groups and the deed. A restart or a death does this, so the next
     * sign-in carries no claims until the player becomes a citizen again.
     */
    readonly wipeClaims: (email: string) => Effect.Effect<void, OracleUnavailable>
    /** The deed the Oracle last granted this player, or null when it has taken it back. */
    readonly deedOf: (email: string) => Effect.Effect<string | null, OracleUnavailable>
  }
>()('OracleAdmin') {}

// The groups the Oracle grants. Scribes are never granted, so there is nothing to take back from them.
const GRANTED = [GROUPS.citizens, GROUPS.knights, GROUPS.scholars]

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

    const mapError = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
      effect.pipe(
        Effect.mapError((error) =>
          error instanceof OracleUnavailable
            ? error
            : new OracleUnavailable({ reason: error instanceof Error ? error.message : String(error) }),
        ),
      )

    const findGroup = (group: string, accessToken: string) =>
      Effect.gen(function* () {
        const groups = yield* find('groups', { search: group, exact: 'true' }, accessToken)
        const found = groups.find((candidate) => candidate.name === group)

        if (!found) return yield* new OracleUnavailable({ reason: `no group ${group}` })

        return found
      })

    const addToGroup = (userId: string, groupId: string, accessToken: string) =>
      HttpClientRequest.put(`${adminUrl}/users/${userId}/groups/${groupId}`).pipe(
        HttpClientRequest.bearerToken(accessToken),
        client.execute,
      )

    const grant = (email: string, group: string) =>
      Effect.gen(function* () {
        const accessToken = yield* token
        const [user] = yield* find('users', { email, exact: 'true' }, accessToken)

        if (!user) return yield* new OracleUnavailable({ reason: `no user for ${email}` })

        const found = yield* findGroup(group, accessToken)
        yield* addToGroup(user.id, found.id, accessToken)
      }).pipe(mapError)

    // The deed attribute goes first, since it's the step that can fail (see below). If the group were added
    // first and the attribute then failed, the player would be a citizen with no deed, and the Oracle would
    // never offer the grant again.
    const grantCitizen = (email: string, deed: string) =>
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
        const citizen = yield* findGroup(GROUPS.citizens, accessToken)

        yield* HttpClientRequest.put(`${adminUrl}/users/${id}`).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.bodyJsonUnsafe({ ...user, attributes: { ...attributes, deed: [deed] } }),
          client.execute,
        )

        // Keycloak answers 204 even when it drops an attribute the user profile doesn't declare (a realm
        // from before the deed), so read it back rather than tell the player it's theirs.
        const stored = yield* HttpClientRequest.get(`${adminUrl}/users/${id}`).pipe(
          HttpClientRequest.bearerToken(accessToken),
          client.execute,
          Effect.flatMap(readJson(UserIdentity)),
        )

        if (stored.attributes?.deed?.[0] !== deed) {
          return yield* new OracleUnavailable({
            reason: "the Oracle didn't keep the deed claim; run ./quest deploy",
          })
        }

        yield* addToGroup(id, citizen.id, accessToken)
      }).pipe(mapError)

    // The groups go first: they open the doors, and the deed is only the key to one house. If the deed then fails,
    // the player is still not a citizen to anyone's door, and a retry clears it.
    const wipeClaims = (email: string) =>
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

        for (const name of GRANTED) {
          const group = yield* findGroup(name, accessToken)

          yield* HttpClientRequest.delete(`${adminUrl}/users/${id}/groups/${group.id}`).pipe(
            HttpClientRequest.bearerToken(accessToken),
            client.execute,
          )
        }

        yield* HttpClientRequest.put(`${adminUrl}/users/${id}`).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.bodyJsonUnsafe({ ...user, attributes: { ...attributes, deed: [NO_DEED] } }),
          client.execute,
        )

        // Read it back, as grantCitizen does: a deed that survived would let the old house's door open.
        const stored = yield* HttpClientRequest.get(`${adminUrl}/users/${id}`).pipe(
          HttpClientRequest.bearerToken(accessToken),
          client.execute,
          Effect.flatMap(readJson(UserIdentity)),
        )

        if (stored.attributes?.deed?.[0] !== NO_DEED) {
          return yield* new OracleUnavailable({
            reason: "the Oracle didn't empty the deed claim; run ./quest deploy",
          })
        }
      }).pipe(mapError)

    const deedOf = (email: string) =>
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

        const { attributes } = yield* Schema.decodeUnknownEffect(UserIdentity)(user)

        const deed = attributes?.deed?.[0]

        return !deed || deed === NO_DEED ? null : deed
      }).pipe(mapError)

    return { grant, grantCitizen, wipeClaims, deedOf }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))
