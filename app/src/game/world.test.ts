import { describe, expect, it } from 'vitest'

import { ALWAYS_AWAKE, BEDS, NPC_BEDS, TILE, buildWorld, goesToBed, nearestBed, same } from './world.ts'

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

describe("the keepers' beds", () => {
  it('are bed tiles in the keepers own buildings, apart from the beds the player is told about', () => {
    const { tiles } = buildWorld()

    for (const bed of Object.values(NPC_BEDS)) {
      expect(tiles[bed.y]?.[bed.x]).toBe(TILE.bed)
      expect(Object.values(BEDS).some((own) => same(own, bed))).toBe(false)
    }
  })

  it('belong to the Captain, the librarian, the falconer and the sage, who keep buildings; everyone else just walks off', () => {
    expect(Object.keys(NPC_BEDS).sort()).toEqual(['captain', 'falconer', 'librarian', 'sage'])
  })

  it("never become the player's nearest bed", () => {
    const { tiles } = buildWorld()

    expect(nearestBed(tiles, { x: 34, y: 25 }, false) ?? '').not.toContain('library')
  })
})

describe('who goes to bed at night', () => {
  it('is everyone but the Oracle, who stays awake like a guard', () => {
    const { npcs } = buildWorld()

    expect([...ALWAYS_AWAKE]).toEqual(['oracle'])
    expect(npcs.filter((npc) => !goesToBed(npc.npcId)).map((npc) => npc.npcId)).toEqual(['oracle'])
    expect(npcs.filter((npc) => goesToBed(npc.npcId))).toHaveLength(npcs.length - 1)
  })

  it('gives nobody who stays awake a bed', () => {
    for (const id of ALWAYS_AWAKE) expect(NPC_BEDS[id]).toBeUndefined()
  })
})
