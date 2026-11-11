import { describe, expect, it } from 'vite-plus/test'
import { GROUPS } from './groups.ts'
import { VISITORS } from './house.ts'
import { ZONES } from './zones.ts'

describe('citizens', () => {
  it('are the Oracle’s citizens group, never an email domain', () => {
    const criteria = ZONES.flatMap((zone) => zone.policy).flatMap((rule) => rule.criteria)

    expect(criteria.some((criterion) => criterion.kind === 'domain')).toBe(false)

    const citizenZones = ZONES.filter((zone) =>
      zone.policy.some((rule) =>
        rule.criteria.some(
          (criterion) =>
            criterion.kind === 'claim' && criterion.claim === 'groups' && criterion.value === GROUPS.citizens,
        ),
      ),
    )

    expect(citizenZones.map((zone) => zone.id)).toEqual([
      'town',
      'guild',
      'scriptorium',
      'library',
      'builder',
      'keep',
      'perch',
      'eyrie',
    ])
  })

  it('include the townsfolk but not the traveler, who comes from outside the kingdom', () => {
    expect(VISITORS.baker.groups).toContain(GROUPS.citizens)
    expect(VISITORS.captain.groups).toContain(GROUPS.citizens)
    expect(VISITORS.librarian.groups).toContain(GROUPS.citizens)
    expect(VISITORS.traveler.groups).not.toContain(GROUPS.citizens)
  })
})

describe('zone routes', () => {
  it('have unique ids and addresses, so Pomerium never has two routes for one path', () => {
    expect(new Set(ZONES.map((zone) => zone.id)).size).toBe(ZONES.length)
    expect(new Set(ZONES.map((zone) => `${zone.host ?? 'game'}${zone.prefix}`)).size).toBe(ZONES.length)
  })

  it('give every MCP server a host of its own, which Pomerium needs to sign MCP clients in', () => {
    const servers = ZONES.filter((zone) => zone.mcp === 'server')

    expect(servers.map((zone) => zone.id)).toEqual(['aviary'])
    expect(servers.every((zone) => zone.host === zone.id)).toBe(true)
    expect(ZONES.filter((zone) => zone.mcp !== 'server').every((zone) => !zone.host)).toBe(true)
  })
})
