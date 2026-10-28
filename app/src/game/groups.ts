/**
 * The groups policies check, named as Pomerium reads them in `claim/groups`. They're plural, since each is a
 * set of players; the stages (citizen, knight) are singular, since they describe one player. The Oracle keeps
 * every group but scribes, which no one can hold, so the scriptorium stays shut.
 */
export const GROUPS = {
  citizens: 'citizens',
  knights: 'knights',
  scholars: 'scholars',
  scribes: 'scribes',
} as const

/**
 * The Oracle adds a player to this group when it takes their claims back, so the `groups` claim is never left
 * out of a token. Keycloak omits the claim when a player has no groups, and Pomerium merges a new sign-in's
 * claims into the user's stored ones without dropping a claim the token lacks, so an emptied claim has to arrive
 * with a value to replace the old one. Policies never check it, and the game hides it from the claims it shows.
 */
export const BASE_GROUP = 'wanderers'

/** What the `deed` claim holds when the Oracle has taken the deed back, for the same reason as BASE_GROUP. */
export const NO_DEED = 'none'
