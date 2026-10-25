// Every gated place in the game is a real Pomerium route: same host, its own path prefix,
// its own policy. scripts/render.ts turns this list into the Pomerium config, and the game
// shows the same policy on signs and denial screens.

/**
 * One PPL criterion, e.g. { kind: 'claim', claim: 'groups', value: 'knights' } renders as
 * `claim/groups: knights`.
 */
export type Criterion =
  | { readonly kind: 'authenticated_user' }
  | { readonly kind: 'domain'; readonly is: string }
  | { readonly kind: 'email'; readonly is: string }
  | { readonly kind: 'http_method'; readonly is: 'GET' | 'POST' }
  | { readonly kind: 'claim'; readonly claim: ClaimName; readonly value: string }

/**
 * One allow rule: `allow: { and: [...] }` or `allow: { or: [...] }`. PPL operators hold
 * criteria, not other operators, so "A and (B or C)" is written as two rules instead:
 * [A and B] and [A and C]. A request is allowed when any rule matches.
 */
export interface AllowRule {
  readonly match: 'and' | 'or'
  readonly criteria: readonly Criterion[]
}

export type ClaimName = 'groups' | 'email'

export type ZoneId = 'oracle' | 'fields' | 'town' | 'guild' | 'armory' | 'library'

export interface Zone {
  readonly id: ZoneId
  readonly name: string
  /** Path prefix Pomerium matches, e.g. /zones/armory */
  readonly prefix: string
  readonly policy: readonly AllowRule[]
}

export const KINGDOM_DOMAIN = 'kingdom.com'

const all = (...criteria: Criterion[]): AllowRule => ({ match: 'and', criteria })
const signedIn: Criterion = { kind: 'authenticated_user' }
const citizen: Criterion = { kind: 'domain', is: KINGDOM_DOMAIN }
const inGroup = (value: string): Criterion => ({ kind: 'claim', claim: 'groups', value })

export const ZONES: readonly Zone[] = [
  { id: 'oracle', name: "Oracle's Temple", prefix: '/zones/oracle', policy: [all(signedIn)] },
  { id: 'fields', name: 'Fields Gate', prefix: '/zones/fields', policy: [all(signedIn)] },
  { id: 'town', name: 'Town Gate', prefix: '/zones/town', policy: [all(citizen)] },
  { id: 'guild', name: "Knights' Guild", prefix: '/zones/guild', policy: [all(citizen)] },
  { id: 'armory', name: 'Armory', prefix: '/zones/armory', policy: [all(inGroup('knights'))] },
  {
    id: 'library',
    name: 'Royal Library',
    prefix: '/zones/library',
    // Citizens may read (GET); scribes may also write (POST).
    policy: [all(citizen, { kind: 'http_method', is: 'GET' }), all(citizen, inGroup('scribes'))],
  },
]

export const zoneById = (id: ZoneId) => {
  const zone = ZONES.find((candidate) => candidate.id === id)

  if (!zone) throw new Error(`unknown zone ${id}`)

  return zone
}

export const findZone = (id: string) => ZONES.find((candidate) => candidate.id === id)
