// Who is calling, according to Pomerium. By the time a request reaches this server Pomerium has already
// allowed it; the signed X-Pomerium-Jwt-Assertion header proves it came through Pomerium, and says who
// the owl is running errands for.
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import type { Config } from './config.ts'

export interface Caller {
  readonly email: string
  /** The `groups` claim in the player's Pomerium session. */
  readonly groups: readonly string[]
}

/** A caller, or why there isn't one. */
export type Verified =
  | { readonly ok: true; readonly caller: Caller }
  | { readonly ok: false; readonly reason: string }

export type Verify = (headers: Headers) => Promise<Verified>

// The claims Pomerium signs into X-Pomerium-Jwt-Assertion.
const PomeriumClaims = z.object({
  sub: z.string(),
  email: z.string().optional(),
  groups: z.array(z.string()).optional(),
})

/** Checks Pomerium's signature against its public keys, and that the JWT was made for the Aviary's route. */
export function pomeriumVerifier(config: Config): Verify {
  const origin = new URL(config.QUEST_AVIARY_ORIGIN)
  const jwks = createRemoteJWKSet(new URL('/.well-known/pomerium/jwks.json', origin))

  return async (headers) => {
    const token = headers.get('x-pomerium-jwt-assertion')

    if (!token) return { ok: false, reason: 'no Pomerium JWT: this request did not come through Pomerium' }

    try {
      // The JWT's audience is the host of the route the request came through.
      const { payload } = await jwtVerify(token, jwks, { audience: [origin.hostname, origin.host] })
      const claims = PomeriumClaims.parse(payload)

      return { ok: true, caller: { email: claims.email ?? claims.sub, groups: claims.groups ?? [] } }
    } catch (error) {
      return {
        ok: false,
        reason: `invalid Pomerium JWT: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
}
