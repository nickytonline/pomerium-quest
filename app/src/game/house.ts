// The player's house: a route whose policy the player writes (docs/prd/your-house.md). Shared by the
// editor in the browser and the server that turns the rules into a real Pomerium route.
import { GROUPS } from './groups.ts'
import { decide, type Identity } from './ppl.ts'
import type { Criterion, PolicyRule } from './zones.ts'

/** Every house is a route under this prefix, followed by its id. */
export const HOUSE_PREFIX = '/zones/home'

/** The most rules a house may have, and the most checks in each. */
export const HOUSE_LIMITS = { rules: 6, criteria: 6 } as const

/**
 * Emails, domains and group names a player may type. Nothing that could break out of the YAML the
 * server writes: no quotes, colons, spaces or newlines.
 */
export const HOUSE_VALUE = /^[A-Za-z0-9@._-]{1,254}$/

/**
 * The rule every saved house starts with, so its owner needs no rule of their own: the Oracle gives the
 * owner a `deed` claim for this game, and whoever carries it always gets in.
 */
export const deedRule = (deed: string): PolicyRule => ({
  action: 'allow',
  match: 'or',
  criteria: [{ kind: 'claim', claim: 'deed', value: deed }],
})

/** The methods the game sends to a house. */
const GAME_METHODS = ['GET', 'POST'] as const

/**
 * Whether these rules would turn the owner away at their own door despite the deed: a deny that matches
 * them always wins over the deed's allow. The desk refuses to save such rules.
 */
export function turnsAwayOwner(rules: readonly HouseRule[], owner: Identity) {
  const anyone: PolicyRule = { action: 'allow', match: 'or', criteria: [{ kind: 'accept' }] }

  // A deny can name a method, so check each one the game uses.
  return GAME_METHODS.some(
    (method) => !decide({ policy: [anyone, ...rules] }, owner, { method, path: '/' }).allow,
  )
}

/** The checks the editor offers. All of them work in open-source Pomerium. */
export type HouseCriterion = Exclude<Criterion, { readonly kind: 'claim' }> | HouseClaimCriterion

/** The deed claim is the house's own door; the editor offers the groups claim only, as the server allows. */
type HouseClaimCriterion = Extract<Criterion, { readonly kind: 'claim' }> & { readonly claim: 'groups' }

export type HouseRule = Omit<PolicyRule, 'criteria'> & { readonly criteria: readonly HouseCriterion[] }

/** The townsfolk's email domain. Citizenship comes from the Oracle's citizens group, never from an address. */
export const TOWNSFOLK_DOMAIN = 'game.localhost.pomerium.io'

/** Who knocks on the player's door. Each is a real account at the Oracle. */
export type VisitorId = 'baker' | 'traveler' | 'captain' | 'librarian'

export interface Visitor {
  readonly name: string
  readonly email: string
  /** The groups the Oracle puts in the visitor's groups claim. */
  readonly groups: readonly string[]
}

/**
 * The townsfolk who visit. They have real accounts at the Oracle, so each knock is a real request with a
 * real session. The traveler comes from outside the kingdom, as at the town gate.
 */
export const VISITORS: Record<VisitorId, Visitor> = {
  baker: { name: 'the baker', email: `baker@${TOWNSFOLK_DOMAIN}`, groups: [GROUPS.citizens] },
  traveler: { name: 'the traveler', email: 'wanderer@outlands.net', groups: [] },
  captain: {
    name: 'the Captain',
    email: `captain@${TOWNSFOLK_DOMAIN}`,
    groups: [GROUPS.citizens, GROUPS.knights],
  },
  librarian: {
    name: 'the Librarian',
    email: `librarian@${TOWNSFOLK_DOMAIN}`,
    groups: [GROUPS.citizens, GROUPS.scholars],
  },
}

export const VISITOR_IDS: readonly VisitorId[] = ['baker', 'traveler', 'captain', 'librarian']

/** Each visitor's password at the Oracle: the deploy's shared secret and their name. */
export const visitorPassword = (secret: string, id: VisitorId) => `${secret}-${id}`

/** A slime bot is a request with no session at all. */
export type Knocker = VisitorId | 'slime'

// The server sends these as JSON, so they're type aliases (not interfaces) to stay assignable to Json.

/** What the server reports after a knock: Pomerium's real answer, and which house rules it used. */
export type Knock = {
  readonly knocker: Knocker
  readonly method: 'GET' | 'POST'
  readonly status: number
  /** The version of the rules Pomerium enforced, or null when it never reached the house. */
  readonly version: string | null
}

/** What the server says about a house after opening or saving it. */
export type HouseState = {
  readonly id: string
  readonly path: string
  /** A short hash of the rules, or "public" before the first save. */
  readonly version: string
  /** Whether Pomerium is enforcing this version yet: it takes up a change a little after it's saved. */
  readonly live: boolean
}

/** A house just opened, with the rules the server holds for it: the player's saved ones, in any browser. */
export type OpenedHouse = HouseState & { readonly rules: readonly HouseRule[] | null }
