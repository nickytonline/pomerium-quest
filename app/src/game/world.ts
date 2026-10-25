import type { ZoneId } from './zones.ts'

// The kingdom map: a 40x30 tile grid built from a few drawing helpers, plus where every
// gate, sign, NPC, monster and prop sits. Tile ids match the order in art/tiles.mjs.

export const TILE = {
  grass: 0,
  flowers: 1,
  path: 2,
  cobble: 3,
  tree: 4,
  wall: 5,
  water: 6,
  floor: 7,
  shelf: 8,
  lectern: 9,
  chest: 10,
  chestOpen: 11,
  sign: 12,
  rock: 13,
  nightGate: 14,
  gateClosed: 15,
  gateOpen: 16,
  fountainTopLeft: 17,
  fountainTopRight: 18,
  fountainBottomLeft: 19,
  fountainBottomRight: 20,
} as const

export type TileId = (typeof TILE)[keyof typeof TILE]

/** The fountain's animation frames follow its first four tiles, four tiles per frame in the same order. */
export const FOUNTAIN_FRAMES = 3

export const isFountain = (tile: number) => tile >= TILE.fountainTopLeft && tile <= TILE.fountainBottomRight

export const WALKABLE: ReadonlySet<number> = new Set([
  TILE.grass,
  TILE.flowers,
  TILE.path,
  TILE.cobble,
  TILE.floor,
])

export const MAP_WIDTH = 40
export const MAP_HEIGHT = 30

export type NpcId = 'sage' | 'oracle' | 'traveler' | 'captain' | 'armorer' | 'librarian'

/** Frame index of each NPC in npcs.png. */
export const NPC_FRAME: Record<NpcId, number> = {
  sage: 0,
  oracle: 1,
  traveler: 2,
  captain: 3,
  armorer: 4,
  librarian: 5,
}

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Gate extends Point {
  readonly zoneId: ZoneId
}

export interface Sign extends Point {
  readonly signId: ZoneId | 'end'
}

export interface Npc extends Point {
  readonly npcId: NpcId
}

export interface World {
  readonly tiles: number[][]
  readonly gates: readonly Gate[]
  readonly signs: readonly Sign[]
  readonly npcs: readonly Npc[]
  /** Bot slimes roam the fields on foot. */
  readonly bots: readonly Point[]
  /** Phish swim only in the fields' pond. */
  readonly phish: readonly Point[]
  readonly rocks: readonly Point[]
  readonly chest: Point
  readonly ledger: Point
  readonly nightGate: Point
  /** Top-left tile of the 2x2 fountain. */
  readonly fountain: Point
  readonly spawn: Point
}

export type Region = 'Hearth Village' | 'Slime Fields' | 'Kingdom Town' | 'Library Quarter'

export function regionAt(point: Point): Region {
  if (point.x <= 15) return point.y >= 18 ? 'Hearth Village' : 'Slime Fields'

  return point.y >= 18 ? 'Library Quarter' : 'Kingdom Town'
}

export function buildWorld(): World {
  const tiles: number[][] = Array.from({ length: MAP_HEIGHT }, () =>
    Array.from({ length: MAP_WIDTH }, (): number => TILE.grass),
  )

  const set = (x: number, y: number, tile: number) => {
    const row = tiles[y]

    if (row && x >= 0 && x < MAP_WIDTH) row[x] = tile
  }

  const fill = (x0: number, y0: number, x1: number, y1: number, tile: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, tile)
  }

  // A walled room with a floor; doors are punched in afterwards.
  const room = (x0: number, y0: number, x1: number, y1: number) => {
    fill(x0, y0, x1, y1, TILE.wall)
    fill(x0 + 1, y0 + 1, x1 - 1, y1 - 1, TILE.floor)
  }

  const each = (points: ReadonlyArray<readonly [number, number]>, tile: number) => {
    for (const [x, y] of points) set(x, y, tile)
  }

  // Border forest and the walls between regions.
  fill(0, 0, MAP_WIDTH - 1, 0, TILE.tree)
  fill(0, MAP_HEIGHT - 1, MAP_WIDTH - 1, MAP_HEIGHT - 1, TILE.tree)
  fill(0, 0, 0, MAP_HEIGHT - 1, TILE.tree)
  fill(MAP_WIDTH - 1, 0, MAP_WIDTH - 1, MAP_HEIGHT - 1, TILE.tree)
  fill(0, 17, 16, 17, TILE.wall)
  fill(16, 0, 16, MAP_HEIGHT - 1, TILE.wall)
  fill(17, 17, 38, 17, TILE.wall)

  // Hearth Village: home, the Oracle's temple, a pond.
  room(2, 19, 6, 22)
  set(4, 22, TILE.floor)
  room(10, 23, 14, 27)
  set(10, 25, TILE.floor)
  fill(2, 25, 4, 27, TILE.water)
  fill(8, 18, 8, 26, TILE.path)
  fill(4, 23, 8, 23, TILE.path)
  fill(8, 25, 9, 25, TILE.path)
  each(
    [
      [12, 19],
      [14, 19],
      [14, 21],
      [1, 23],
      [6, 27],
      [15, 28],
    ],
    TILE.tree,
  )

  // Slime Fields, with the pond the phish lurk in.
  fill(2, 5, 5, 7, TILE.water)
  fill(8, 12, 8, 16, TILE.path)
  fill(8, 12, 15, 12, TILE.path)
  each(
    [
      [2, 2],
      [3, 2],
      [2, 3],
      [6, 6],
      [11, 3],
      [12, 3],
      [12, 4],
      [3, 9],
      [4, 9],
      [13, 8],
      [5, 14],
      [2, 14],
      [14, 16],
      [10, 7],
      [1, 11],
      [14, 3],
      [7, 2],
    ],
    TILE.tree,
  )
  each(
    [
      [5, 3],
      [9, 9],
      [11, 13],
      [3, 12],
      [13, 15],
      [6, 16],
    ],
    TILE.flowers,
  )

  // Kingdom Town: square, guild hall, armory.
  fill(17, 12, 38, 12, TILE.cobble)
  fill(24, 9, 31, 15, TILE.cobble)
  // One 2x2 fountain in the middle of the square.
  const fountain = { x: 27, y: 11 }
  set(fountain.x, fountain.y, TILE.fountainTopLeft)
  set(fountain.x + 1, fountain.y, TILE.fountainTopRight)
  set(fountain.x, fountain.y + 1, TILE.fountainBottomLeft)
  set(fountain.x + 1, fountain.y + 1, TILE.fountainBottomRight)
  room(18, 2, 24, 7)
  room(30, 2, 37, 7)
  fill(21, 8, 21, 11, TILE.cobble)
  fill(33, 8, 33, 11, TILE.cobble)
  fill(27, 16, 28, 16, TILE.cobble)
  each(
    [
      [18, 9],
      [18, 15],
      [37, 11],
      [37, 14],
      [23, 16],
    ],
    TILE.tree,
  )
  each(
    [
      [19, 13],
      [35, 14],
      [25, 6],
    ],
    TILE.flowers,
  )

  // Library Quarter.
  fill(27, 18, 28, 19, TILE.cobble)
  fill(20, 19, 33, 19, TILE.cobble)
  fill(21, 19, 21, 28, TILE.cobble)
  room(29, 20, 37, 27)
  fill(30, 22, 32, 22, TILE.shelf)
  fill(34, 22, 36, 22, TILE.shelf)
  each(
    [
      [18, 24],
      [19, 26],
      [25, 24],
      [24, 21],
      [37, 18],
      [26, 27],
    ],
    TILE.tree,
  )

  const gates: Gate[] = [
    { x: 8, y: 17, zoneId: 'fields' },
    { x: 16, y: 12, zoneId: 'town' },
    { x: 21, y: 7, zoneId: 'guild' },
    { x: 33, y: 7, zoneId: 'armory' },
    { x: 33, y: 20, zoneId: 'library' },
  ]

  for (const gate of gates) set(gate.x, gate.y, TILE.gateClosed)

  const signs: Sign[] = [
    { x: 7, y: 18, signId: 'fields' },
    { x: 15, y: 13, signId: 'town' },
    { x: 20, y: 8, signId: 'guild' },
    { x: 32, y: 8, signId: 'armory' },
    { x: 35, y: 19, signId: 'library' },
    { x: 22, y: 27, signId: 'end' },
  ]

  for (const sign of signs) set(sign.x, sign.y, TILE.sign)

  const rocks = [
    { x: 27, y: 17 },
    { x: 28, y: 17 },
  ]

  for (const rock of rocks) set(rock.x, rock.y, TILE.rock)

  const chest = { x: 33, y: 4 }
  set(chest.x, chest.y, TILE.chest)
  const ledger = { x: 33, y: 25 }
  set(ledger.x, ledger.y, TILE.lectern)
  const nightGate = { x: 21, y: 29 }
  set(nightGate.x, nightGate.y, TILE.nightGate)

  return {
    tiles,
    gates,
    signs,
    rocks,
    chest,
    ledger,
    nightGate,
    fountain,
    npcs: [
      { x: 12, y: 25, npcId: 'sage' },
      { x: 4, y: 20, npcId: 'oracle' },
      { x: 14, y: 11, npcId: 'traveler' },
      { x: 21, y: 4, npcId: 'captain' },
      { x: 34, y: 9, npcId: 'armorer' },
      { x: 31, y: 25, npcId: 'librarian' },
    ],
    bots: [
      { x: 10, y: 2 },
      { x: 6, y: 10 },
      { x: 12, y: 14 },
      { x: 3, y: 15 },
      { x: 13, y: 6 },
    ],
    phish: [
      { x: 2, y: 5 },
      { x: 5, y: 6 },
      { x: 3, y: 7 },
    ],
    spawn: { x: 9, y: 25 },
  }
}
