import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

const load = async (domain: string | undefined) => {
  vi.resetModules()

  if (domain === undefined) vi.stubEnv('QUEST_KINGDOM_DOMAIN', '')
  else vi.stubEnv('QUEST_KINGDOM_DOMAIN', domain)

  return import('./zones.ts')
}

describe('the citizens domain', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to the game itself, never a real third-party domain', async () => {
    const { KINGDOM_DOMAIN } = await load(undefined)

    expect(KINGDOM_DOMAIN).toBe('game.localhost.pomerium.io')
  })

  it('follows QUEST_KINGDOM_DOMAIN into every policy that checks citizens', async () => {
    const { ZONES } = await load('example.org')

    const citizenZones = ZONES.filter((zone) =>
      zone.policy.some((rule) => rule.criteria.some((criterion) => criterion.kind === 'domain')),
    )

    expect(citizenZones.map((zone) => zone.id)).toEqual([
      'town',
      'guild',
      'scriptorium',
      'library',
      'builder',
      'keep',
    ])

    for (const zone of citizenZones) {
      const domains = zone.policy
        .flatMap((rule) => rule.criteria)
        .flatMap((c) => (c.kind === 'domain' ? [c.is] : []))

      expect(domains, zone.id).toEqual(['example.org'])
    }
  })

  it('gives the townsfolk addresses in that domain, with the traveler outside it', async () => {
    const { VISITORS } = await (async () => {
      await load('example.org')

      return import('./house.ts')
    })()

    expect(VISITORS.baker.email).toBe('baker@example.org')
    expect(VISITORS.captain.email).toBe('captain@example.org')
    expect(VISITORS.traveler.email.endsWith('@example.org')).toBe(false)
  })
})

describe('zone routes', () => {
  it('have unique ids and prefixes, so Pomerium never has two routes for one path', async () => {
    const { ZONES } = await load(undefined)

    expect(new Set(ZONES.map((zone) => zone.id)).size).toBe(ZONES.length)
    expect(new Set(ZONES.map((zone) => zone.prefix)).size).toBe(ZONES.length)
  })
})
