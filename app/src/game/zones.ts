// Every gated place in the game is a real Pomerium route: same host, its own path prefix,
// its own policy. scripts/render.ts turns this list into the Pomerium config, and the game
// shows the same policy on signs and denial screens.

import { GROUPS } from './groups.ts'

/**
 * One PPL criterion, e.g. { kind: 'claim', claim: 'groups', value: 'knights' } renders as
 * `claim/groups: knights`.
 */
export type Criterion =
  /** Matches every request, even with no session: the PPL behind allow_public_unauthenticated_access. */
  | { readonly kind: 'accept' }
  | { readonly kind: 'authenticated_user' }
  | { readonly kind: 'domain'; readonly is: string }
  | { readonly kind: 'email'; readonly is: string }
  | { readonly kind: 'http_method'; readonly is: 'GET' | 'POST' }
  | { readonly kind: 'claim'; readonly claim: ClaimName; readonly value: string }

/**
 * One rule: `allow: { and: [...] }`, `deny: { or: [...] }` and so on. PPL operators hold criteria, not
 * other operators, so "A and (B or C)" is written as two rules instead: [A and B] and [A and C]. A
 * request is allowed when any allow rule matches and no deny rule does.
 */
export interface PolicyRule {
  readonly action: 'allow' | 'deny'
  /** `not` matches when none of its criteria do. */
  readonly match: 'and' | 'or' | 'not'
  readonly criteria: readonly Criterion[]
}

export type ClaimName = 'groups' | 'email' | 'deed'

export type ZoneId =
  | 'oracle'
  | 'fields'
  | 'town'
  | 'guild'
  | 'armory'
  | 'scriptorium'
  | 'library'
  | 'keep'
  | 'builder'

export interface Zone {
  readonly id: ZoneId
  readonly name: string
  /** Path prefix Pomerium matches, e.g. /zones/armory */
  readonly prefix: string
  readonly policy: readonly PolicyRule[]
}

/** Posted to the game by the sign-in frame once Pomerium hands it back with a session. */
export const SIGNED_IN_MESSAGE = 'pomerium-quest/signed-in'

const all = (...criteria: Criterion[]): PolicyRule => ({ action: 'allow', match: 'and', criteria })
const signedIn: Criterion = { kind: 'authenticated_user' }
const inGroup = (value: string): Criterion => ({ kind: 'claim', claim: 'groups', value })

/** A citizen is whoever the Oracle has put in the citizens group, whatever their email domain. */
const citizen = inGroup(GROUPS.citizens)

export const ZONES: readonly Zone[] = [
  { id: 'oracle', name: "Oracle's Temple", prefix: '/zones/oracle', policy: [all(signedIn)] },
  { id: 'fields', name: 'Fields Gate', prefix: '/zones/fields', policy: [all(signedIn)] },
  { id: 'town', name: 'Town Gate', prefix: '/zones/town', policy: [all(citizen)] },
  { id: 'guild', name: "Knights' Guild", prefix: '/zones/guild', policy: [all(citizen)] },
  { id: 'armory', name: 'Armory', prefix: '/zones/armory', policy: [all(inGroup(GROUPS.knights))] },
  // The scriptorium's path sits inside the library's, so its route is the more specific match and Pomerium
  // checks its policy instead of the library's.
  {
    id: 'scriptorium',
    name: 'Scriptorium',
    prefix: '/zones/library/scriptorium',
    policy: [all(citizen, inGroup(GROUPS.scribes))],
  },
  // Citizens may read (GET) and nothing more.
  {
    id: 'library',
    name: 'Royal Library',
    prefix: '/zones/library',
    policy: [all(citizen, { kind: 'http_method', is: 'GET' })],
  },
  // Where players save their own house's door rules (docs/prd/your-house.md). The game server only ever
  // writes the house of the player Pomerium signed in.
  { id: 'builder', name: "Builders' Yard", prefix: '/zones/builder', policy: [all(citizen)] },
  // The end of the quest: one rule, and every check in it must pass.
  {
    id: 'keep',
    name: 'Royal Keep',
    prefix: '/zones/keep',
    policy: [all(citizen, inGroup(GROUPS.knights), inGroup(GROUPS.scholars))],
  },
]

export const zoneById = (id: ZoneId) => {
  const zone = ZONES.find((candidate) => candidate.id === id)

  if (!zone) throw new Error(`unknown zone ${id}`)

  return zone
}

export const findZone = (id: string) => ZONES.find((candidate) => candidate.id === id)
