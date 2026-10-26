import { describe, expect, it } from 'vite-plus/test'
import { VISITORS } from './house.ts'
import { ZONES } from './zones.ts'

describe('citizens', () => {
  it('are the Oracle’s citizen group, never an email domain', () => {
    const criteria = ZONES.flatMap((zone) => zone.policy).flatMap((rule) => rule.criteria)

    expect(criteria.some((criterion) => criterion.kind === 'domain')).toBe(false)

    const citizenZones = ZONES.filter((zone) =>
      zone.policy.some((rule) =>
        rule.criteria.some(
          (criterion) =>
            criterion.kind === 'claim' && criterion.claim === 'groups' && criterion.value === 'citizen',
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
    ])
  })

  it('include the townsfolk but not the traveler, who comes from outside the kingdom', () => {
    expect(VISITORS.baker.groups).toContain('citizen')
    expect(VISITORS.captain.groups).toContain('citizen')
    expect(VISITORS.librarian.groups).toContain('citizen')
    expect(VISITORS.traveler.groups).not.toContain('citizen')
  })
})

describe('zone routes', () => {
  it('have unique ids and prefixes, so Pomerium never has two routes for one path', () => {
    expect(new Set(ZONES.map((zone) => zone.id)).size).toBe(ZONES.length)
    expect(new Set(ZONES.map((zone) => zone.prefix)).size).toBe(ZONES.length)
  })
})
