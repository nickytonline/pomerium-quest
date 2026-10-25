// Every gated place in the game is a real Pomerium route: same host, its own path prefix,
// its own policy. scripts/render.ts turns this list into the Pomerium config, and the game
// shows the same policy on signs and denial screens.

export type PPLNode =
  | { and: PPLNode[] }
  | { or: PPLNode[] }
  | { authenticated_user: true }
  | { domain: { is: string } }
  | { email: { is: string } }
  | { http_method: { is: string } }
  | { [claim: `claim/${string}`]: string }

export interface Zone {
  id: string
  name: string
  /** Path prefix Pomerium matches, e.g. /zones/armory */
  prefix: string
  policy: { allow: PPLNode }
}

export const KINGDOM_DOMAIN = 'kingdom.com'

export const ZONES: Zone[] = [
  {
    id: 'oracle',
    name: "Oracle's Temple",
    prefix: '/zones/oracle',
    policy: { allow: { and: [{ authenticated_user: true }] } },
  },
  {
    id: 'fields',
    name: 'Fields Gate',
    prefix: '/zones/fields',
    policy: { allow: { and: [{ authenticated_user: true }] } },
  },
  {
    id: 'town',
    name: 'Town Gate',
    prefix: '/zones/town',
    policy: { allow: { and: [{ domain: { is: KINGDOM_DOMAIN } }] } },
  },
  {
    id: 'guild',
    name: "Knights' Guild",
    prefix: '/zones/guild',
    policy: { allow: { and: [{ domain: { is: KINGDOM_DOMAIN } }] } },
  },
  {
    id: 'armory',
    name: 'Armory',
    prefix: '/zones/armory',
    policy: { allow: { and: [{ 'claim/groups': 'knights' }] } },
  },
  {
    id: 'library',
    name: 'Royal Library',
    prefix: '/zones/library',
    policy: {
      allow: {
        and: [
          { domain: { is: KINGDOM_DOMAIN } },
          { or: [{ http_method: { is: 'GET' } }, { 'claim/groups': 'scribes' }] },
        ],
      },
    },
  },
]

export const zoneById = (id: string) => {
  const zone = ZONES.find(z => z.id === id)
  if (!zone) throw new Error(`unknown zone ${id}`)
  return zone
}
