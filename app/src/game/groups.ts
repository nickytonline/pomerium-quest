/**
 * The groups policies check, named as Pomerium reads them in `claim/groups`. The Oracle keeps every group
 * but scribes, which no one can hold, so the scriptorium stays shut.
 */
export const GROUPS = {
  citizen: 'citizen',
  knights: 'knights',
  scholars: 'scholars',
  scribes: 'scribes',
} as const
