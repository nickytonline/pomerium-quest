// How the game asks for access: every gate is a real HTTP request through Pomerium, and the
// status code is the answer.
import type { HouseRule, HouseState, Knock, Knocker, OpenedHouse } from './house.ts'
import type { OwlCall, OwlFlight } from './perch.ts'
import { type Identity } from './ppl.ts'
import { ANONYMOUS, type Mode } from './store.ts'
import { type Zone } from './zones.ts'

export type Outcome =
  | { readonly kind: 'allow'; readonly message: string | null }
  | { readonly kind: 'deny'; readonly requestId: string | null }
  | { readonly kind: 'signin'; readonly requestId: string | null }
  | { readonly kind: 'error'; readonly message: string }

interface OracleResponse {
  readonly player?: {
    readonly email: string
    readonly groups: readonly string[]
    readonly deed: string | null
  } | null
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

// Pomerium answers an unauthenticated request with a redirect to sign in, or with a 401
// when the request asks for JSON (as the game's fetches do).
const needsSignIn = (response: Response) =>
  response.type === 'opaqueredirect' || response.status === 302 || response.status === 401

/** Finds out whether Pomerium is in front of us and, if so, who we are. */
export async function probe(): Promise<{ mode: Mode; identity: Identity }> {
  try {
    const response = await fetch('/zones/oracle/', {
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })

    if (needsSignIn(response)) return { mode: 'pomerium', identity: ANONYMOUS }

    // Anything else but the signed-in player (the game's server reached without Pomerium,
    // Pomerium restarting) means there's no Pomerium to play through.
    if (!response.ok) return { mode: 'unreachable', identity: ANONYMOUS }
    // SAFETY: our own server route returns this JSON shape (app/src/server/zones.ts).
    const body = (await response.json()) as OracleResponse

    if (!body.player) return { mode: 'unreachable', identity: ANONYMOUS }
    const { email, groups, deed } = body.player

    return { mode: 'pomerium', identity: { authenticated: true, email, groups, deed: deed ?? undefined } }
  } catch {
    return { mode: 'unreachable', identity: ANONYMOUS }
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

export async function requestZone(zone: Zone, method: 'GET' | 'POST', action: string): Promise<Outcome> {
  const path = `${zone.prefix}/${action}`

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
 * Waits for Pomerium to refresh the session until `ready` accepts the player's claims, or gives up (null).
 * The game never signs out to get fresh claims: a sign-out that lands back in the game needs Pomerium's
 * allow_any_sign_out_redirect_uri flag, an open redirect. Pomerium refreshes the session by itself, about a
 * minute after the Oracle changes a claim.
 */
export async function waitForClaims(
  ready: (identity: Identity) => boolean,
  { everyMs = 3000, giveUpMs = 150_000 } = {},
): Promise<Identity | null> {
  const until = Date.now() + giveUpMs
  let wait = everyMs

  while (Date.now() < until) {
    const { identity } = await probe()

    if (identity.authenticated && ready(identity)) return identity

    // Back off and add jitter, so many players waiting at once don't poll in lockstep.
    await new Promise((resolve) => setTimeout(resolve, wait * (0.75 + Math.random() * 0.5)))
    wait = Math.min(wait * 1.25, 10_000)
  }

  return null
}

/** The builder's answer: the value it sent, or why it couldn't. */
export type Built<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

/** What the Builders' Yard accepts: the door rules, or who should knock and how. */
type BuilderRequest =
  | { readonly rules: readonly HouseRule[] | null }
  | Record<string, never>
  | { readonly knocker: Knocker; readonly method: 'GET' | 'POST' }

interface BuilderError {
  readonly error?: string
  readonly reason?: string
}

/**
 * Asks the Builders' Yard (a Pomerium route like any other) to do something with the player's house.
 * The server always works on the house of whoever Pomerium signed in.
 */
async function builder<T>(action: string, body: BuilderRequest): Promise<Built<T>> {
  try {
    const response = await fetch(`/zones/builder/${action}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (response.ok) {
      // SAFETY: our own server route answers with this JSON shape (app/src/server/zones.ts).
      return { ok: true, value: (await response.json()) as T }
    }

    // SAFETY: the builder's error responses carry error and reason; anything else yields the status.
    const error = (await response.json().catch(() => ({}))) as BuilderError

    return { ok: false, message: error.error ?? `${response.status} ${response.statusText}` }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

export const openHouse = (rules: readonly HouseRule[] | null) => builder<OpenedHouse>('open', { rules })
export const saveHouse = (rules: readonly HouseRule[]) => builder<HouseState>('save', { rules })

/** The Oracle makes the player a citizen and grants the deed to their house. */
export async function claimCitizenship(): Promise<Built<null>> {
  try {
    const response = await fetch('/zones/oracle/citizen', {
      method: 'POST',
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })

    if (!response.ok) return { ok: false, message: `${response.status} ${response.statusText}` }

    return { ok: true, value: null }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

/** The house as it stands, and whether Pomerium has taken up its latest rules. */
export const houseStatus = () => builder<HouseState>('status', {})

export const knockAs = (knocker: Knocker, method: 'GET' | 'POST') =>
  builder<Knock>('knock', { knocker, method })

/** How long the player's knock keeps trying while Pomerium takes up new rules, as the visitors' knocks do. */
const PICKUP_MS = 25_000

/** A flight that hasn't come back by now is lost, so the perch is freed. Longer than the server's own wait. */
const FLIGHT_TIMEOUT_MS = 20_000

/** The Falconer's errand signs in first, then flies, so it gets longer than a player's owl. */
const FALCONER_TIMEOUT_MS = 35_000

/** One knock by the player: Pomerium's status, and the rules version the house saw if it got in. */
async function knockOnce(path: string, method: 'GET' | 'POST') {
  try {
    const response = await fetch(`${path}knock`, {
      method,
      redirect: 'manual',
      headers: { accept: 'application/json' },
    })

    if (response.type === 'opaqueredirect') return { status: 302, version: null }

    // SAFETY: a house answers with its rules version (app/src/server/zones.ts); anything else has none.
    const answer = (await response.json().catch(() => ({}))) as { version?: string | null }

    return { status: response.status, version: answer.version ?? null }
  } catch {
    return { status: 0, version: null }
  }
}

/**
 * The player at their own door: a real request with their own session, straight from the browser.
 * Pomerium takes a moment to pick up saved rules, and until then the old rules (an older version) or no
 * route at all (404) can answer, so it knocks again until the house's current rules do.
 */
export async function knockYourself(house: HouseState, method: 'GET' | 'POST'): Promise<number> {
  const started = Date.now()

  for (;;) {
    const { status, version } = await knockOnce(house.path, method)
    const current = status === 200 ? version === house.version : status !== 404

    if (current || Date.now() - started > PICKUP_MS) return status

    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

/**
 * Asks the Falconer to send their own owl to open the cage. The game server makes the same kind of request
 * as for the player's owl, but signed in as the Falconer, so Pomerium decides it on the Falconer's behalf.
 */
export async function sendFalconersOwl(): Promise<Built<OwlFlight>> {
  try {
    const response = await fetch('/zones/perch/falconer', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(FALCONER_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })

    if (needsSignIn(response)) return { ok: false, message: 'You have no session. Sign in with the Oracle.' }

    if (!response.ok) return { ok: false, message: `${response.status} ${response.statusText}` }

    // SAFETY: our own server route answers with this JSON shape (app/src/server/perch.ts).
    return { ok: true, value: (await response.json()) as OwlFlight }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}

/**
 * Sends the owl from a perch: the game server makes the MCP request to the Aviary with the token Pomerium
 * gave it for the player. The perch is a Pomerium route too, so it can refuse before the owl ever flies.
 */
export async function sendOwl(call: OwlCall): Promise<Built<OwlFlight>> {
  try {
    const response = await fetch('/zones/perch/aviary', {
      method: 'POST',
      redirect: 'manual',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(call),
      signal: AbortSignal.timeout(FLIGHT_TIMEOUT_MS),
    })

    if (needsSignIn(response)) return { ok: false, message: 'You have no session. Sign in with the Oracle.' }

    if (!response.ok) return { ok: false, message: `${response.status} ${response.statusText}` }

    // SAFETY: our own server route answers with this JSON shape (app/src/server/perch.ts).
    return { ok: true, value: (await response.json()) as OwlFlight }
  } catch (error) {
    return { ok: false, message: String(error) }
  }
}
