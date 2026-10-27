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
 * Every player belongs to this group from sign-up, so the `groups` claim is never left out of a token. Pomerium
 * merges a new sign-in's claims into the user's stored ones and never drops a claim the token lacks, so an
 * emptied claim has to arrive with a value to replace the old one. Policies never check it.
 */
export const BASE_GROUP = 'wanderers'

/** What the `deed` claim holds when the Oracle has taken the deed back, for the same reason as BASE_GROUP. */
export const NO_DEED = 'none'
