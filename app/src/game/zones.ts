// Every gated place in the game is a real Pomerium route: same host, its own path prefix,
// its own policy. scripts/render.ts turns this list into the Pomerium config, and the game
// shows the same policy on signs and denial screens.

import { GROUPS } from './groups.ts'
import { AVIARY_HOST, FORBIDDEN_PREFIX, MCP_PATH } from './owl.ts'

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
  /** Matches when the claim's list does not hold the value: `claim/groups: { exclude: knights }`. */
  | { readonly kind: 'claim_exclude'; readonly claim: ClaimName; readonly value: string }
  /** Matches an MCP tools/call request for a tool whose name starts this way, and nothing else: not even a tools/list. */
  | { readonly kind: 'mcp_tool'; readonly startsWith: string }

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
  | 'perch'
  | 'aviary'
  | 'eyrie'

export interface Zone {
  readonly id: ZoneId
  readonly name: string
  /** Path prefix Pomerium matches, e.g. /zones/armory */
  readonly prefix: string
  readonly policy: readonly PolicyRule[]
  /** A zone with a host of its own (aviary.<domain>) instead of a path on the game's. MCP servers need one. */
  readonly host?: typeof AVIARY_HOST
  /**
   * An MCP route. A `server` is where tools are called: Pomerium signs MCP clients in and can check each
   * tool call. A `client` is an app that calls MCP servers for its user: Pomerium hands it a token to do so.
   */
  readonly mcp?: 'server' | 'client'
}

/** Posted to the game by the sign-in frame once Pomerium hands it back with a session. */
export const SIGNED_IN_MESSAGE = 'pomerium-quest/signed-in'

const all = (...criteria: Criterion[]): PolicyRule => ({ action: 'allow', match: 'and', criteria })
const denyAll = (...criteria: Criterion[]): PolicyRule => ({ action: 'deny', match: 'and', criteria })
const signedIn: Criterion = { kind: 'authenticated_user' }
const inGroup = (value: string): Criterion => ({ kind: 'claim', claim: 'groups', value })

/** A citizen is whoever the Oracle has put in the citizens group, whatever their email domain. */
const citizen = inGroup(GROUPS.citizens)

/**
 * What the Royal Keep asks, and so what finishing chapter one means: a citizen who is a knight and a scholar.
 * Walking into chapter two's grounds asks the same, and so does the owl's perch.
 */
const keepsRule = all(citizen, inGroup(GROUPS.knights), inGroup(GROUPS.scholars))

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
  // The end of chapter one: one rule, and every check in it must pass.
  {
    id: 'keep',
    name: 'Royal Keep',
    prefix: '/zones/keep',
    policy: [keepsRule],
  },
  // Chapter two, beyond the keep. The perch is where the player sends their owl from, and its route is
  // the game's MCP client route: Pomerium hands the game server a token for the signed-in player, and the
  // server sends the owl's tool calls with it. Anyone the keep admits may send an owl.
  { id: 'perch', name: "The Owl's Perch", prefix: '/zones/perch', policy: [keepsRule], mcp: 'client' },
  // The Aviary is the MCP server, behind this one route. Only a falconer's owl gets in at all. One deny rule
  // then keeps a class of tools, by the start of their names, for the owls of distinguished falconers: the
  // rule matches a call to such a tool from anyone whose groups lack that one, and a deny beats the allow.
  {
    id: 'aviary',
    name: 'The Aviary',
    host: AVIARY_HOST,
    prefix: MCP_PATH,
    policy: [
      all(inGroup(GROUPS.falconers)),
      denyAll(
        { kind: 'mcp_tool', startsWith: FORBIDDEN_PREFIX },
        { kind: 'claim_exclude', claim: 'groups', value: GROUPS.distinguishedFalconers },
      ),
    ],
    mcp: 'server',
  },
  // The end of chapter two, as the keep ends chapter one: one rule, asking for everything both chapters earn.
  {
    id: 'eyrie',
    name: 'The Eyrie',
    prefix: '/zones/eyrie',
    policy: [all(...keepsRule.criteria, inGroup(GROUPS.falconers), inGroup(GROUPS.keyholders))],
  },
]

export const zoneById = (id: ZoneId) => {
  const zone = ZONES.find((candidate) => candidate.id === id)

  if (!zone) throw new Error(`unknown zone ${id}`)

  return zone
}

export const findZone = (id: string) => ZONES.find((candidate) => candidate.id === id)
