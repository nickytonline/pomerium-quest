// How the game asks for access. In Pomerium mode every gate is a real HTTP request through
// Pomerium and the status code is the answer. In simulated mode (plain `vp dev`, no
// Pomerium) the same policy is evaluated in the browser.
import { decide, type Identity } from './ppl.ts'
import { ANONYMOUS, type Mode, type Progress } from './store.ts'
import { KINGDOM_DOMAIN, type Zone } from './zones.ts'

export type Outcome =
  | { readonly kind: 'allow'; readonly message: string | null }
  | { readonly kind: 'deny'; readonly requestId: string | null }
  | { readonly kind: 'signin'; readonly requestId: string | null }
  | { readonly kind: 'error'; readonly message: string }

interface OracleResponse {
  readonly mode?: string
  readonly player?: { readonly email: string; readonly groups: readonly string[] } | null
}

interface ZoneResponse {
  readonly message?: string
}

/** Pomerium's JSON error body, e.g. {"error":"Forbidden","request_id":"…"}. */
interface PomeriumError {
  readonly request_id?: string
}

async function readRequestId(response: Response) {
  try {
    // SAFETY: Pomerium's JSON error responses carry request_id; anything else yields null.
    const body = (await response.json()) as PomeriumError

    return body.request_id ?? null
  } catch {
    return null
  }
}

const SIM_EMAIL = `hero@${KINGDOM_DOMAIN}`

export function simulatedIdentity(progress: Progress): Identity {
  if (!progress.sim.signedIn) return ANONYMOUS

  return {
    authenticated: true,
    email: SIM_EMAIL,
    groups: progress.sim.groups,
  }
}

// Pomerium answers an unauthenticated request with a redirect to sign in, or with a 401
// when the request asks for JSON (as the game's fetches do).
const needsSignIn = (response: Response) =>
  response.type === 'opaqueredirect' || response.status === 302 || response.status === 401

/** Finds out whether Pomerium is in front of us and, if so, who we are. */
export async function probe(progress: Progress): Promise<{ mode: Mode; identity: Identity }> {
  try {
    const response = await fetch('/zones/oracle/', {
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })

    if (needsSignIn(response)) return { mode: 'pomerium', identity: ANONYMOUS }
    // SAFETY: our own server route returns this JSON shape (app/src/server/zones.ts).
    const body = (await response.json()) as OracleResponse

    if (body.mode === 'simulated') return { mode: 'simulated', identity: simulatedIdentity(progress) }

    if (body.player) {
      const { email, groups } = body.player

      return {
        mode: 'pomerium',
        identity: { authenticated: true, email, groups },
      }
    }

    return { mode: 'pomerium', identity: ANONYMOUS }
  } catch {
    // Only the game's own server says "simulated". An error (Pomerium restarting, a proxy's HTML
    // error page) must not hand out the simulated hero: treat the player as signed out instead.
    return { mode: 'pomerium', identity: ANONYMOUS }
  }
}

async function readMessage(response: Response) {
  try {
    // SAFETY: zone handlers answer with JSON; a non-JSON body just yields no message.
    const body = (await response.json()) as ZoneResponse

    return body.message ?? null
  } catch {
    return null
  }
}

export async function requestZone(
  mode: Mode,
  identity: Identity,
  zone: Zone,
  method: 'GET' | 'POST',
  action: string,
): Promise<Outcome> {
  const path = `${zone.prefix}/${action}`

  if (mode === 'simulated') {
    if (!identity.authenticated) return { kind: 'signin', requestId: null }

    if (!decide(zone, identity, { method, path }).allow) return { kind: 'deny', requestId: null }
  }

  try {
    const response = await fetch(path, {
      method,
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })

    if (needsSignIn(response)) return { kind: 'signin', requestId: await readRequestId(response) }

    if (response.status === 403) return { kind: 'deny', requestId: await readRequestId(response) }

    if (!response.ok) return { kind: 'error', message: `${response.status} ${response.statusText}` }

    return { kind: 'allow', message: await readMessage(response) }
  } catch (error) {
    return { kind: 'error', message: String(error) }
  }
}

/** Where to send the browser to sign in through Pomerium, landing back in the game. */
export const signInUrl = () => '/zones/oracle/signin'

/**
 * Sign out of the Pomerium session, and with it the Oracle's (Keycloak ends its session too).
 * Pomerium's signout_redirect_url sends the player straight back to sign in, which picks up
 * fresh claims from the Oracle.
 */
export const refreshClaimsUrl = () => '/.pomerium/sign_out'

/**
 * Sign out of Pomerium and the Oracle, landing back on the title screen signed out.
 * Overriding signout_redirect_url needs Pomerium's allow_any_sign_out_redirect_uri flag.
 */
export const signOutUrl = () =>
  `/.pomerium/sign_out?pomerium_redirect_uri=${encodeURIComponent(`${location.origin}/`)}`
