import { describe, expect, it } from 'vitest'

import { buildWorld, nearestBed } from './world.ts'

const { tiles } = buildWorld()

describe('nearestBed', () => {
  it('finds the guest bed from Hearth Village, through the house door', () => {
    expect(nearestBed(tiles, { x: 9, y: 25 }, false)).toContain("sage's guest bed")
  })

  it('finds the inn from the town square, not a bed past a gate', () => {
    expect(nearestBed(tiles, { x: 27, y: 13 }, false)).toContain('inn')
  })

  it('stays on the level: the Aviary has only the hut', () => {
    expect(nearestBed(tiles, { x: 24, y: 33 }, true)).toContain('hut')
  })

  it("goes to the player's own bed in the fields once they have a house", () => {
    expect(nearestBed(tiles, { x: 10, y: 10 }, true)).toContain('your own bed')
  })

  it('walks through a gate when no bed is reachable without one', () => {
    expect(nearestBed(tiles, { x: 10, y: 4 }, false)).not.toBeNull()
  })
})
