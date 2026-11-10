// Who is calling, according to Pomerium. By the time a request reaches this server Pomerium has already
// allowed it; the signed X-Pomerium-Jwt-Assertion header proves it came through Pomerium, and says who
// the owl is running errands for and which of the two routes it flew in by.
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { ROOSTS, type Roost } from '../../app/src/game/owl.ts'
import type { Config } from './config.ts'

export interface Caller {
  readonly email: string
  /** The `groups` claim in the player's Pomerium session. */
  readonly groups: readonly string[]
  /** The route the request came through: the JWT's audience is that route's host. */
  readonly roost: Roost
}

/** A caller, or why there isn't one. */
export type Verified =
  | { readonly ok: true; readonly caller: Caller }
  | { readonly ok: false; readonly reason: string }

export type Verify = (headers: Headers) => Promise<Verified>

// The claims Pomerium signs into X-Pomerium-Jwt-Assertion.
const PomeriumClaims = z.object({
  sub: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  email: z.string().optional(),
  groups: z.array(z.string()).optional(),
})

/** Checks Pomerium's signature against its public keys, and that the JWT was made for one of our routes. */
export function pomeriumVerifier(config: Config): Verify {
  const origins: Record<Roost, URL> = {
    aviary: new URL(config.QUEST_AVIARY_ORIGIN),
    rookery: new URL(config.QUEST_ROOKERY_ORIGIN),
  }

  const jwks = createRemoteJWKSet(new URL('/.well-known/pomerium/jwks.json', origins.aviary))
  const hostsOf = (roost: Roost) => [origins[roost].hostname, origins[roost].host]

  return async (headers) => {
    const token = headers.get('x-pomerium-jwt-assertion')

    if (!token) return { ok: false, reason: 'no Pomerium JWT: this request did not come through Pomerium' }

    try {
      const { payload } = await jwtVerify(token, jwks, { audience: ROOSTS.flatMap(hostsOf) })
      const claims = PomeriumClaims.parse(payload)
      const audiences = [claims.aud].flat()
      const roost = ROOSTS.find((candidate) => hostsOf(candidate).some((host) => audiences.includes(host)))

      if (!roost) return { ok: false, reason: 'the Pomerium JWT was made for another route' }

      return { ok: true, caller: { email: claims.email ?? claims.sub, groups: claims.groups ?? [], roost } }
    } catch (error) {
      return {
        ok: false,
        reason: `invalid Pomerium JWT: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
}
