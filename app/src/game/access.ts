// How the game asks for access. In Pomerium mode every gate is a real HTTP request through
// Pomerium and the status code is the answer. In simulated mode (plain `vp dev`, no
// Pomerium) the same policy is evaluated in the browser.
import { decide, type Identity } from './ppl.ts'
import { ANONYMOUS, type Mode, type Progress } from './store.ts'
import { KINGDOM_DOMAIN, type Zone } from './zones.ts'

export type Outcome =
  | { readonly kind: 'allow'; readonly message: string | null }
  | { readonly kind: 'deny' }
  | { readonly kind: 'signin' }
  | { readonly kind: 'error'; readonly message: string }

interface OracleResponse {
  readonly mode?: string
  readonly player?: { readonly email: string; readonly groups: readonly string[] } | null
}

interface ZoneResponse {
  readonly message?: string
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

const redirected = (response: Response) => response.type === 'opaqueredirect' || response.status === 302

/** Finds out whether Pomerium is in front of us and, if so, who we are. */
export async function probe(progress: Progress): Promise<{ mode: Mode; identity: Identity }> {
  try {
    const response = await fetch('/zones/oracle/', {
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })

    if (redirected(response)) return { mode: 'pomerium', identity: ANONYMOUS }
    // SAFETY: our own server route returns this JSON shape (app/src/server/zones.ts).
    const body = (await response.json()) as OracleResponse

    if (body.mode === 'pomerium' && body.player) {
      const { email, groups } = body.player

      return {
        mode: 'pomerium',
        identity: { authenticated: true, email, groups },
      }
    }

    return { mode: 'simulated', identity: simulatedIdentity(progress) }
  } catch {
    return { mode: 'simulated', identity: simulatedIdentity(progress) }
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
    if (!identity.authenticated) return { kind: 'signin' }

    if (!decide(zone, identity, { method, path }).allow) return { kind: 'deny' }
  }

  try {
    const response = await fetch(path, {
      method,
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })

    if (redirected(response)) return { kind: 'signin' }

    if (response.status === 403) return { kind: 'deny' }

    if (!response.ok) return { kind: 'error', message: `${response.status} ${response.statusText}` }

    return { kind: 'allow', message: await readMessage(response) }
  } catch (error) {
    return { kind: 'error', message: String(error) }
  }
}

/** Where to send the browser to sign in through Pomerium, landing back in the game. */
export const signInUrl = () => '/zones/oracle/signin'

/** Sign out of the Pomerium session, then sign straight back in to pick up fresh claims. */
export const refreshClaimsUrl = () =>
  `/.pomerium/sign_out?pomerium_redirect_uri=${encodeURIComponent(`${location.origin}${signInUrl()}`)}`
