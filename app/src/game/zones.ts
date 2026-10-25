// Every gated place in the game is a real Pomerium route: same host, its own path prefix,
// its own policy. scripts/render.ts turns this list into the Pomerium config, and the game
// shows the same policy on signs and denial screens.

/**
 * The slice of Pomerium Policy Language the game uses. Each node renders to the PPL YAML
 * Pomerium reads, e.g. { kind: 'claim', claim: 'groups', value: 'knights' } becomes
 * `claim/groups: knights`.
 */
export type PPLNode =
  | { readonly kind: 'and'; readonly rules: readonly PPLNode[] }
  | { readonly kind: 'or'; readonly rules: readonly PPLNode[] }
  | { readonly kind: 'authenticated_user' }
  | { readonly kind: 'domain'; readonly is: string }
  | { readonly kind: 'email'; readonly is: string }
  | { readonly kind: 'http_method'; readonly is: 'GET' | 'POST' }
  | { readonly kind: 'claim'; readonly claim: ClaimName; readonly value: string }

export type ClaimName = 'groups' | 'email'

export type ZoneId = 'oracle' | 'fields' | 'town' | 'guild' | 'armory' | 'library'

export interface Zone {
  readonly id: ZoneId
  readonly name: string
  /** Path prefix Pomerium matches, e.g. /zones/armory */
  readonly prefix: string
  readonly policy: { readonly allow: PPLNode }
}

export const KINGDOM_DOMAIN = 'kingdom.com'

const and = (...rules: PPLNode[]): PPLNode => ({ kind: 'and', rules })
const or = (...rules: PPLNode[]): PPLNode => ({ kind: 'or', rules })
const signedIn: PPLNode = { kind: 'authenticated_user' }
const citizen: PPLNode = { kind: 'domain', is: KINGDOM_DOMAIN }
const inGroup = (value: string): PPLNode => ({ kind: 'claim', claim: 'groups', value })

export const ZONES: readonly Zone[] = [
  { id: 'oracle', name: "Oracle's Temple", prefix: '/zones/oracle', policy: { allow: and(signedIn) } },
  { id: 'fields', name: 'Fields Gate', prefix: '/zones/fields', policy: { allow: and(signedIn) } },
  { id: 'town', name: 'Town Gate', prefix: '/zones/town', policy: { allow: and(citizen) } },
  { id: 'guild', name: "Knights' Guild", prefix: '/zones/guild', policy: { allow: and(citizen) } },
  { id: 'armory', name: 'Armory', prefix: '/zones/armory', policy: { allow: and(inGroup('knights')) } },
  {
    id: 'library',
    name: 'Royal Library',
    prefix: '/zones/library',
    policy: { allow: and(citizen, or({ kind: 'http_method', is: 'GET' }, inGroup('scribes'))) },
  },
]

export const zoneById = (id: ZoneId) => {
  const zone = ZONES.find((candidate) => candidate.id === id)

  if (!zone) throw new Error(`unknown zone ${id}`)

  return zone
}

export const findZone = (id: string) => ZONES.find((candidate) => candidate.id === id)
