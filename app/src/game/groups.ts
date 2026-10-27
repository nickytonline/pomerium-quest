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
