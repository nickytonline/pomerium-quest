import { Context, Effect, Layer, Schema } from 'effect'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { QuestConfig } from './config.ts'
import { InvalidAssertion, MissingAssertion } from './errors.ts'

// A type alias (not an interface) so it stays assignable to the Json response type.
export type Player = {
  readonly email: string
  readonly name: string
  readonly groups: ReadonlyArray<string>
  /** The id of the player's house, once the Oracle has granted the deed. */
  readonly deed: string | null
  readonly issuer: string
}

// The claims Pomerium signs into X-Pomerium-Jwt-Assertion.
const PomeriumClaims = Schema.Struct({
  iss: Schema.String,
  sub: Schema.String,
  email: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  groups: Schema.optional(Schema.Array(Schema.String)),
  deed: Schema.optional(Schema.String),
})

// jwt_claims_headers forwards the IdP's groups claim as a comma-separated header.
const groupsFromHeader = (header: string | null) =>
  (header ?? '')
    .split(',')
    .map((group) => group.trim())
    .filter((group) => group.length > 0)

export class PomeriumIdentity extends Context.Service<
  PomeriumIdentity,
  {
    readonly verify: (request: Request) => Effect.Effect<Player, MissingAssertion | InvalidAssertion>
  }
>()('PomeriumIdentity') {}

export const PomeriumIdentityLive = Layer.effect(
  PomeriumIdentity,
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const origin = new URL(config.publicOrigin)
    const jwks = createRemoteJWKSet(new URL('/.well-known/pomerium/jwks.json', origin))

    const verify = (request: Request) =>
      Effect.gen(function* () {
        const token = request.headers.get('x-pomerium-jwt-assertion')

        if (!token) return yield* new MissingAssertion()

        const { payload } = yield* Effect.tryPromise({
          try: () => jwtVerify(token, jwks, { audience: [origin.hostname, origin.host] }),
          catch: (cause) => new InvalidAssertion({ reason: String(cause) }),
        })

        const claims = yield* Schema.decodeUnknownEffect(PomeriumClaims)(payload).pipe(
          Effect.mapError((issue) => new InvalidAssertion({ reason: issue.message })),
        )

        const headerGroups = groupsFromHeader(request.headers.get('x-pomerium-claim-groups'))
        const email = claims.email ?? claims.sub

        return {
          email,
          name: claims.name || (email.split('@')[0] ?? email),
          groups: headerGroups.length > 0 ? headerGroups : (claims.groups ?? []),
          deed: claims.deed || null,
          issuer: claims.iss,
        }
      })

    return { verify }
  }),
)
