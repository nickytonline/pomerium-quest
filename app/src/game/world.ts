import type { SignId } from './content.ts'
import { OWL_TOOLS, type OwlTool } from './owl.ts'
import type { ZoneId } from './zones.ts'

// The kingdom map: a 40x49 tile grid built from a few drawing helpers, plus where every
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
  anvil: 29,
  workbench: 30,
  tableBread: 31,
  tableCrumbs: 32,
  tableBitten: 33,
  desk: 34,
  door: 35,
  doorLocked: 36,
  deskLetter: 37,
  doorClosed: 38,
  tableHalf: 39,
  tableHeel: 40,
  signIndoors: 41,
  perch: 42,
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

/**
 * The dog can also swim, and walk through the door of their own house. Monsters keep to their own
 * terrain, so bot slimes stay out of the water and only get into the house when Pomerium lets them.
 */
export const PLAYER_TERRAIN: ReadonlySet<number> = new Set([...WALKABLE, TILE.water, TILE.door])

export const MAP_WIDTH = 40
export const MAP_HEIGHT = 49

/** The Royal Keep's wall: chapter one's kingdom lies above this row, and the Aviary below it. */
const KEEP_WALL = 29

/** The last wall: the Aviary's open ground lies above this row, and the Eyrie below it. */
const EYRIE_WALL = 43

/** A tile's size in game pixels. */
export const TILE_PX = 16

/** About how much of the map the game board shows: this many tiles' worth, shaped to the window. */
export const BOARD_TILES = { cols: 16, rows: 12 } as const

export type NpcId =
  | 'sage'
  | 'oracle'
  | 'traveler'
  | 'captain'
  | 'armorer'
  | 'librarian'
  | 'baker'
  | 'falconer'
  | 'friend'

/** Frame index of each NPC in npcs.png. */
export const NPC_FRAME: Record<NpcId, number> = {
  sage: 0,
  oracle: 1,
  traveler: 2,
  captain: 3,
  armorer: 4,
  librarian: 5,
  baker: 6,
  falconer: 9,
  friend: 10,
}

/** Phish dress as the Oracle, so their frame in npcs.png follows the real NPCs'. */
export const PHISH_FRAME = 7

/** A guard stands in every gateway; the frame after the phish in npcs.png. */
export const GUARD_FRAME = 8

export interface Point {
  readonly x: number
  readonly y: number
}

export const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y

/** What a guard asks Pomerium: `method` on the path `action` under the zone's route. */
export interface GateRequest {
  readonly zoneId: ZoneId
  readonly method: 'GET'
  readonly action: 'enter'
}

/** A gate asks its zone's route to let the player in; its guard follows the rules on sign `signId`. */
export interface Gate extends Point, GateRequest {
  readonly signId: SignId
  /** The zone outside the gate, whose route is asked with a GET on the way out. Unguarded ground has none. */
  readonly exitZoneId?: ZoneId
}

export interface Sign extends Point {
  readonly signId: SignId
}

/** A perch stands for one of the Aviary's tools: sending the owl to it calls that tool. */
export interface Perch extends Point {
  readonly tool: OwlTool
  /** The sign beside it, which names the tool. */
  readonly sign: Point
}

export interface Npc extends Point {
  readonly npcId: NpcId
}

/** The player's house in the Slime Fields (docs/prd/your-house.md). */
export interface House {
  readonly door: Point
  /** The path outside the door, where slimes and visitors knock. */
  readonly doorstep: Point
  readonly desk: Point
  /** The table, with the loaf on it. */
  readonly table: Point
  /** Just above the table, where the traveler stands to eat, facing it. */
  readonly seat: Point
  /** The sign outside, which shows the house's route. */
  readonly sign: Point
  /** The floor inside, corner to corner. */
  readonly inside: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
}

export const HOUSE: House = {
  door: { x: 7, y: 12 },
  doorstep: { x: 8, y: 12 },
  desk: { x: 2, y: 10 },
  table: { x: 4, y: 13 },
  seat: { x: 4, y: 12 },
  sign: { x: 8, y: 11 },
  inside: { x0: 2, y0: 10, x1: 6, y1: 14 },
}

export const inHouse = (point: Point) =>
  point.x >= HOUSE.inside.x0 &&
  point.x <= HOUSE.inside.x1 &&
  point.y >= HOUSE.inside.y0 &&
  point.y <= HOUSE.inside.y1

export interface World {
  readonly tiles: number[][]
  readonly gates: readonly Gate[]
  readonly signs: readonly Sign[]
  readonly npcs: readonly Npc[]
  /** Bot slimes roam the fields on foot. */
  readonly bots: readonly Point[]
  /** Phish, dressed as the Oracle, wait outside town to offer a sign-in that isn't his. */
  readonly phish: readonly Point[]
  readonly rocks: readonly Point[]
  readonly chest: Point
  /** One perch for each of the Aviary's tools, in open ground: no wall or gate stands around any of them. */
  readonly perches: readonly Perch[]
  /** Where the owl waits to be caught, in order: it hops to the next when the player gets close, and tires at the last. */
  readonly owlSpots: readonly Point[]
  /** Where Mochi's falcon is lost, until the player finds it. */
  readonly falcon: Point
  /** Where a game saved somewhere the Aviary's grounds no longer have resumes: just inside the keep. */
  readonly aviaryEntry: Point
  /** Top-left tile of the 2x2 fountain. */
  readonly fountain: Point
  readonly spawn: Point
}

export type Region =
  | 'Hearth Village'
  | 'Slime Fields'
  | 'Your House'
  | 'Kingdom Town'
  | 'Library Quarter'
  | 'The Aviary'
  | 'The Eyrie'

export function regionAt(point: Point): Region {
  if (inHouse(point) || same(point, HOUSE.door)) return 'Your House'

  if (point.y > EYRIE_WALL) return 'The Eyrie'

  if (point.y > KEEP_WALL) return 'The Aviary'

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

  // Slime Fields, with a pond of fish, and the player's house below it.
  fill(2, 5, 5, 7, TILE.water)
  room(1, 9, 7, 15)
  set(HOUSE.door.x, HOUSE.door.y, TILE.doorLocked)
  set(HOUSE.desk.x, HOUSE.desk.y, TILE.desk)
  set(HOUSE.table.x, HOUSE.table.y, TILE.tableBread)
  set(HOUSE.sign.x, HOUSE.sign.y, TILE.sign)
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
      [13, 8],
      [14, 16],
      [10, 7],
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
  // The road south to the Royal Keep, chapter one's last gate.
  fill(21, 19, 21, 28, TILE.cobble)
  // The library: a reading room, and the scriptorium walled off at its west end behind a door of its own.
  room(24, 20, 37, 27)
  fill(29, 21, 29, 26, TILE.wall)
  fill(30, 22, 32, 22, TILE.shelf)
  fill(34, 22, 36, 22, TILE.shelf)
  each(
    [
      [18, 24],
      [19, 26],
      [23, 22],
      [37, 18],
      [23, 27],
    ],
    TILE.tree,
  )

  // The Royal Keep's wall closes off the south of the kingdom. West of the road, thick forest stands
  // behind it; east, beyond the keep's gate, lie the Aviary's grounds.
  fill(0, KEEP_WALL, 16, KEEP_WALL, TILE.tree)
  fill(17, KEEP_WALL, MAP_WIDTH - 2, KEEP_WALL, TILE.wall)
  fill(1, KEEP_WALL + 1, 15, MAP_HEIGHT - 2, TILE.tree)

  // The Aviary's grounds: open ground from the keep down to the last wall. A road runs past the Falconer,
  // east, then south to the Eyrie's gate. The perches stand in the open, so only policy keeps an owl off one.
  fill(21, 30, 21, 33, TILE.cobble)
  fill(21, 33, 35, 33, TILE.cobble)
  fill(28, 34, 28, EYRIE_WALL - 1, TILE.cobble)
  // The Royal Vault: a landmark with no door. Nothing opens it, and one perch beside it never does either.
  fill(34, 35, 37, 37, TILE.wall)
  // The Eyrie, behind the quest's last gate, where Mochi waits.
  fill(17, EYRIE_WALL, MAP_WIDTH - 2, EYRIE_WALL, TILE.wall)
  fill(28, EYRIE_WALL + 1, 28, EYRIE_WALL + 2, TILE.cobble)
  each(
    [
      [18, 31],
      [31, 31],
      [37, 31],
      [38, 33],
      [18, 35],
      [26, 37],
      [38, 36],
      [22, 38],
      [18, 39],
      // The falcon's corner: trees on three sides.
      [36, 40],
      [37, 40],
      [38, 41],
      [17, 42],
      [19, 45],
      [22, 46],
      [36, 46],
      [33, 44],
    ],
    TILE.tree,
  )
  each(
    [
      [19, 33],
      [29, 31],
      [34, 32],
      [30, 36],
      [23, 37],
      [26, 42],
      [33, 41],
      [25, 45],
      [31, 46],
      [24, 47],
      [30, 44],
      [34, 46],
    ],
    TILE.flowers,
  )

  const perches: Perch[] = [
    { x: 24, y: 35, tool: OWL_TOOLS.whoami },
    { x: 19, y: 37, tool: OWL_TOOLS.ringBell },
    { x: 24, y: 40, tool: OWL_TOOLS.scoutGrounds },
    { x: 31, y: 40, tool: OWL_TOOLS.deliverLetter },
    // Beside the vault it would open, if any policy allowed it.
    { x: 35, y: 38, tool: OWL_TOOLS.openVault },
    { x: 19, y: 41, tool: OWL_TOOLS.openCages },
  ].map((perch) => ({ ...perch, sign: { x: perch.x + 1, y: perch.y } }))

  for (const perch of perches) {
    set(perch.x, perch.y, TILE.perch)
    set(perch.sign.x, perch.sign.y, TILE.sign)
  }

  // Leaving through a gate puts the player back in the zone they passed to reach it, so its guard checks
  // that zone's rule again. The fields open onto Hearth Village, which no route guards.
  // Every guard asks with a GET to /enter.
  const enter = { method: 'GET', action: 'enter' } as const

  const gates: Gate[] = [
    { x: 8, y: 17, zoneId: 'fields', signId: 'fields', ...enter },
    { x: 16, y: 12, zoneId: 'town', signId: 'town', ...enter, exitZoneId: 'fields' },
    { x: 21, y: 7, zoneId: 'guild', signId: 'guild', ...enter, exitZoneId: 'town' },
    { x: 33, y: 7, zoneId: 'armory', signId: 'armory', ...enter, exitZoneId: 'town' },
    { x: 33, y: 20, zoneId: 'library', signId: 'library', ...enter, exitZoneId: 'town' },
    { x: 29, y: 24, zoneId: 'scriptorium', signId: 'scriptorium', ...enter, exitZoneId: 'library' },
    { x: 21, y: KEEP_WALL, zoneId: 'keep', signId: 'keep', ...enter, exitZoneId: 'town' },
    { x: 28, y: EYRIE_WALL, zoneId: 'eyrie', signId: 'eyrie', ...enter, exitZoneId: 'keep' },
  ]

  for (const gate of gates) set(gate.x, gate.y, TILE.gateClosed)

  const signs: Sign[] = [
    { x: 7, y: 18, signId: 'fields' },
    { x: 15, y: 13, signId: 'town' },
    { x: 20, y: 8, signId: 'guild' },
    { x: 32, y: 8, signId: 'armory' },
    { x: 35, y: 19, signId: 'library' },
    { x: 30, y: 25, signId: 'scriptorium' },
    { x: 22, y: 28, signId: 'keep' },
    { x: 29, y: EYRIE_WALL - 1, signId: 'eyrie' },
    // The Aviary's sign shows the MCP server's route and lists its tools; no gate stands beside it.
    { x: 20, y: 31, signId: 'aviary' },
  ]

  // A sign takes on the ground it stands on, so one inside a building stands on its floor, not grass.
  for (const sign of signs)
    set(sign.x, sign.y, tiles[sign.y]?.[sign.x] === TILE.floor ? TILE.signIndoors : TILE.sign)

  const rocks = [
    { x: 27, y: 17 },
    { x: 28, y: 17 },
  ]

  for (const rock of rocks) set(rock.x, rock.y, TILE.rock)

  const chest = { x: 33, y: 4 }
  set(chest.x, chest.y, TILE.chest)
  set(31, 4, TILE.anvil)
  set(35, 3, TILE.workbench)
  // The Royal Ledger on its lectern. Getting past the scriptorium door is the write, so it's only scenery.
  set(26, 22, TILE.lectern)

  return {
    tiles,
    gates,
    signs,
    rocks,
    chest,
    perches,
    owlSpots: [
      { x: 26, y: 31 },
      { x: 32, y: 38 },
      { x: 22, y: 41 },
      { x: 31, y: 35 },
    ],
    falcon: { x: 37, y: 41 },
    aviaryEntry: { x: 21, y: 31 },
    fountain,
    npcs: [
      { x: 12, y: 25, npcId: 'sage' },
      { x: 4, y: 20, npcId: 'oracle' },
      { x: 14, y: 11, npcId: 'traveler' },
      { x: 21, y: 4, npcId: 'captain' },
      { x: 34, y: 9, npcId: 'armorer' },
      { x: 34, y: 25, npcId: 'librarian' },
      { x: 30, y: 13, npcId: 'baker' },
      { x: 23, y: 32, npcId: 'falconer' },
      // Mochi waits in the Eyrie, at the end of the path from its gate.
      { x: 28, y: 46, npcId: 'friend' },
    ],
    bots: [
      { x: 10, y: 2 },
      { x: 10, y: 15 },
      { x: 12, y: 14 },
      { x: 5, y: 16 },
      { x: 13, y: 6 },
    ],
    phish: [
      { x: 7, y: 4 },
      { x: 11, y: 10 },
    ],
    spawn: { x: 9, y: 25 },
  }
}
