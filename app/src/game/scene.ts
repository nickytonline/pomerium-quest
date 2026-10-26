// The overworld: tile map, grid movement, sword, monsters. Talking, reading and asking guards are
// delegated to story.ts; this file only moves things around and draws them.
import * as Phaser from 'phaser'
import { startPlayer } from './player-machine.ts'
import { SHEETS } from './sheets.ts'
import { sfx } from './sound.ts'
import { KNIGHT_QUOTA, defeated, hasSteel, type MonsterKind } from './quest-machine.ts'
import { houseStage } from './house-machine.ts'
import {
  enterHouse,
  readHouseSign,
  readLetter,
  readTable,
  ringBell,
  slimeKnocks,
  travelerWelcome,
} from './house-story.ts'
import { MAX_HP, buzz, quest, type Dir } from './store.ts'
import {
  drinkFromFountain,
  eatFish,
  enterGate,
  meetPhish,
  openChest,
  readAnvil,
  readBook,
  readSign,
  readWorkbench,
  talk,
} from './story.ts'
import {
  GUARD_FRAME,
  HOUSE,
  MAP_HEIGHT,
  MAP_WIDTH,
  NPC_FRAME,
  PHISH_FRAME,
  PLAYER_TERRAIN,
  FOUNTAIN_FRAMES,
  TILE,
  WALKABLE,
  isFountain,
  buildWorld,
  inHouse,
  regionAt,
  same,
  type Gate,
  type GateRequest,
  type NpcId,
  type Point,
} from './world.ts'

const T = 16
const STEP_MS = 140
const VIEW = { width: 16 * T, height: 12 * T }

const STEP: Record<Dir, Point> = {
  down: { x: 0, y: 1 },
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = { down: 'up', up: 'down', right: 'left', left: 'right' }
const DOG_FRAME: Record<Dir, number> = { down: 0, up: 3, right: 6, left: 9 }

const DIR_KEYS: Record<Dir, readonly string[]> = {
  up: ['UP', 'W'],
  down: ['DOWN', 'S'],
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
}

type Action = Dir | 'interact' | 'attack'

const KEY_ACTIONS = new Map<string, Action>([
  ['ArrowUp', 'up'],
  ['KeyW', 'up'],
  ['ArrowDown', 'down'],
  ['KeyS', 'down'],
  ['ArrowLeft', 'left'],
  ['KeyA', 'left'],
  ['ArrowRight', 'right'],
  ['KeyD', 'right'],
  ['KeyE', 'interact'],
  ['Enter', 'interact'],
  ['Space', 'attack'],
  ['KeyJ', 'attack'],
])

const DIRS: readonly Dir[] = ['down', 'up', 'right', 'left']

const SWORD_ANGLE: Record<Dir, number> = { up: 0, right: 90, down: 180, left: 270 }

/** Facing up or down, the sword pivots at its grip (row 14 of 16) and sweeps from the dog's side across the front. */
const SWORD_GRIP = 14 / 16
const SWING = { from: 100, to: -50, ms: 160 }

/** What a player hears when the game has lost their session somewhere they could only be with one. */
const LOST_SESSION = 'Something went wrong and your session was lost, so you start again in Hearth Village.'

const ITEM = { swordWood: 0, swordSteel: 1 }

/** Rows of the dog's frame left above the waterline while swimming: head and collar. */
const SWIM_DEPTH = 11

/** Shaking dry after a swim: a pause, then this many swings, each shifting the dog up to `reach` pixels. */
const SHAKE = { delayMs: 250, swings: 9, swingMs: 55, reach: 2 }

/** A monster's bite takes a full heart (health counts half hearts). */
const HIT_DAMAGE = 2

/** Fish swim in each pond, at most FISH_MAX at a time; a new one arrives FISH_RESPAWN_MS after one is eaten. */
const PONDS: readonly Pond[] = [
  { x0: 2, y0: 25, x1: 4, y1: 27 },
  { x0: 2, y0: 5, x1: 5, y1: 7 },
]

const FISH_MAX = 2
const FISH_RESPAWN_MS = 30_000
const FISH_FRAME = 5

/** A phish within `reach` steps calls out to the player, at most once every `ms`. */
const PHISH_CALL = { reach: 3, ms: 20_000 }

/** Monsters never leave the fields. */
const FIELDS = { x0: 1, y0: 1, x1: 15, y1: 16 }

/** How often a slime on the doorstep may try the player's door. */
const SLIME_KNOCK_MS = 15_000

/** Where a slime Pomerium lets in appears, just inside the door. */
const SLIME_IN = { x: 5, y: 13 }

/** The traveler roams the fields and, every so often, tries the player's door to get at the bread. */
const TRAVELER = {
  stepMs: 300,
  /** Roaming, a pause of between one and two of these before each step. */
  roamMs: 900,
  /** The first visit comes soon after the game starts; later ones about this far apart. */
  firstVisitMs: 15_000,
  visitMs: 45_000,
  eatMs: 9_000,
  biteMs: 1_200,
  /** How many times a blocked step is tried again before the traveler finds another way. */
  patience: 4,
}

/** Bread crumbs: crust, crumb and the pale inside of the loaf. */
const CRUMB_COLORS = [0xc98a3c, 0x8a5a24, 0xe3b06a]
const CRUMB_LINGER_MS = 4_000

/** Each kind's first frame in items.png (two frames each), hit points and name. */
const MONSTER: Record<MonsterKind, { readonly frame: number; readonly hp: number; readonly name: string }> = {
  bot: { frame: 3, hp: 2, name: 'Bot slime' },
}

/**
 * What the traveler is doing: roaming the fields, walking to the doorstep, asking Pomerium to let them
 * in, walking to the chair, eating, or walking back out.
 */
type TravelerPlan = 'roam' | 'visit' | 'knock' | 'enter' | 'eat' | 'leave'

interface Traveler {
  plan: TravelerPlan
  /** The steps left to where the plan takes them. */
  path: Point[]
  moving: boolean
  nextMoveAt: number
  /** Unset until the first frame, since the scene's clock doesn't start at zero. */
  nextVisitAt: number | undefined
  doneEatingAt: number
  nextBiteAt: number
  blocked: number
}

interface Pond {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

interface Fish {
  readonly sprite: Phaser.GameObjects.Sprite
  readonly pond: Pond
  x: number
  y: number
  nextMoveAt: number
  moving: boolean
}

interface Monster {
  readonly kind: MonsterKind
  /** Field monsters roam the fields; one Pomerium let into the player's house stays inside it. */
  home: 'fields' | 'house'
  readonly sprite: Phaser.GameObjects.Sprite
  x: number
  y: number
  hp: number
  nextMoveAt: number
  moving: boolean
}

/**
 * A guard stands at `post`, the tile in front of its gate, until Pomerium allows the player; then they
 * step aside and stand at `spot` until the player is through.
 */
interface Guard {
  readonly gate: Gate
  readonly post: Point
  readonly sprite: Phaser.GameObjects.Sprite
  spot: Point
}

/** A phish stands still, dressed as the Oracle; `index` is its place in the world's list. */
interface Phish {
  readonly index: number
  readonly sprite: Phaser.GameObjects.Sprite
  readonly x: number
  readonly y: number
  calledAt: number
}

const center = (tile: number) => tile * T + T / 2
const keyOf = (p: Point) => `${p.x},${p.y}`
const inFields = (p: Point) => p.x >= FIELDS.x0 && p.x <= FIELDS.x1 && p.y >= FIELDS.y0 && p.y <= FIELDS.y1
const isDoorstep = (p: Point) => same(p, HOUSE.doorstep)
const isSeat = (p: Point) => same(p, HOUSE.seat)

/** Where the traveler eats: the chair, or failing that any tile beside the table. */
const atTable = (p: Point) =>
  inHouse(p) && (same(p, HOUSE.seat) || Math.abs(p.x - HOUSE.table.x) + Math.abs(p.y - HOUSE.table.y) === 1)

interface NpcSprite {
  readonly npcId: NpcId
  x: number
  y: number
  readonly sprite: Phaser.GameObjects.Sprite
}

export class KingdomScene extends Phaser.Scene {
  private readonly world = buildWorld()
  private map: Phaser.Tilemaps.Tilemap | undefined
  private player: Phaser.GameObjects.Sprite | undefined
  private sword: Phaser.GameObjects.Image | undefined
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {}
  private pos: Point = { x: 0, y: 0 }
  /** Where the player was before their last step, to tell when they walk into the house. */
  private previous: Point = { x: 0, y: 0 }
  private dir: Dir = 'down'
  private readonly mode = startPlayer()
  private openGate: Guard | undefined
  private guards: Guard[] = []
  /** An item shown rising out of a chest until the player closes its dialog. */
  private shownItem: Phaser.GameObjects.Image | undefined
  private monsters: Monster[] = []
  private fish: Fish[] = []
  private phish: Phish[] = []
  private shake: Phaser.Time.TimerEvent | undefined
  private seen = { interact: 0, attack: 0 }
  private pending = new Set<Action>()
  private lastRockHint = 0
  /** The Oracle, appearing beside the player to sign them in again with new claims. */
  private visitingOracle: Phaser.GameObjects.Sprite | undefined
  /** Townsfolk, where they stand now. Only the traveler moves: around the fields and into the house. */
  private npcs: NpcSprite[] = []
  private traveler: Traveler = {
    plan: 'roam',
    path: [],
    moving: false,
    nextMoveAt: 0,
    nextVisitAt: undefined,
    doneEatingAt: 0,
    nextBiteAt: 0,
    blocked: 0,
  }
  /** The tile the player is stepping onto, until they arrive. */
  private walkingTo: Point | undefined
  /** A slime is asking Pomerium to let it into the player's house, or did so recently. */
  private slimeKnockedAt = -Infinity
  private stopWatching: (() => void) | undefined

  constructor() {
    super('kingdom')
  }

  preload() {
    const frames = { frameWidth: T, frameHeight: T }
    this.load.spritesheet('dog', SHEETS.dog, frames)
    this.load.spritesheet('items', SHEETS.items, frames)
    this.load.spritesheet('npcs', SHEETS.npcs, frames)
    this.load.image('tiles', SHEETS.tiles)
  }

  create() {
    const { progress, controls } = quest.get()
    this.pos = { x: progress.x, y: progress.y }
    this.previous = this.pos
    this.dir = progress.dir
    this.seen = { interact: controls.interact, attack: controls.attack }

    for (const rock of progress.brokenRocks) {
      const [x = 0, y = 0] = rock.split(',').map(Number)
      this.setTile({ x, y }, TILE.cobble, false)
    }

    if (hasSteel()) this.setTile(this.world.chest, TILE.chestOpen, false)

    const map = this.make.tilemap({ data: this.world.tiles, tileWidth: T, tileHeight: T })
    const tileset = map.addTilesetImage('tiles')

    if (!tileset) throw new Error('tileset failed to load')
    map.createLayer(0, tileset, 0, 0)
    this.map = map
    this.animateFountain()

    this.npcs = this.world.npcs.map((npc) => ({
      ...npc,
      sprite: this.add.sprite(center(npc.x), center(npc.y), 'npcs', NPC_FRAME[npc.npcId]),
    }))

    this.dressHouse()

    this.guards = this.world.gates.map((gate) => {
      const post = this.postOf(gate)

      return {
        gate,
        post,
        spot: post,
        sprite: this.add.sprite(center(post.x), center(post.y), 'npcs', GUARD_FRAME),
      }
    })

    // A game saved mid-gateway resumes with that gate open and its guard already aside.
    const passing = this.guards.find((guard) => same(guard.gate, this.pos) || same(guard.post, this.pos))

    if (passing) this.letThrough(passing, false)

    for (const [kind, { frame }] of Object.entries(MONSTER))
      this.anims.create({
        key: kind,
        frames: this.anims.generateFrameNumbers('items', { frames: [frame, frame + 1] }),
        frameRate: 3,
        repeat: -1,
      })

    const spawn = (kind: MonsterKind) => (spot: Point) => ({
      kind,
      sprite: this.add.sprite(center(spot.x), center(spot.y), 'items', MONSTER[kind].frame).play(kind),
      home: 'fields' as const,
      x: spot.x,
      y: spot.y,
      hp: MONSTER[kind].hp,
      nextMoveAt: 0,
      moving: false,
    })

    this.monsters = this.world.bots.map(spawn('bot'))

    this.phish = this.world.phish.flatMap((spot, index) =>
      progress.phishTurnedAway.includes(index)
        ? []
        : [
            {
              index,
              sprite: this.add.sprite(center(spot.x), center(spot.y), 'npcs', PHISH_FRAME),
              x: spot.x,
              y: spot.y,
              calledAt: -Infinity,
            },
          ],
    )

    this.anims.create({
      key: 'fish',
      frames: this.anims.generateFrameNumbers('items', { frames: [FISH_FRAME, FISH_FRAME + 1] }),
      frameRate: 4,
      repeat: -1,
    })

    for (const pond of PONDS) for (let i = 0; i < FISH_MAX; i++) this.spawnFish(pond)

    for (const dir of DIRS) {
      const base = DOG_FRAME[dir]
      this.anims.create({
        key: `walk-${dir}`,
        frames: this.anims.generateFrameNumbers('dog', { frames: [base + 1, base, base + 2, base] }),
        frameRate: 12,
        repeat: -1,
      })
    }

    this.player = this.add
      .sprite(center(this.pos.x), center(this.pos.y), 'dog', DOG_FRAME[this.dir])
      .setDepth(10)
    this.swim(this.tileAt(this.pos) === TILE.water)
    this.sword = this.add.image(0, 0, 'items', ITEM.swordWood).setVisible(false).setDepth(9)

    this.cameras.main.setBounds(0, 0, MAP_WIDTH * T, MAP_HEIGHT * T)
    this.cameras.main.startFollow(this.player, true)
    this.cameras.main.setRoundPixels(true)

    const keyboard = this.input.keyboard

    if (keyboard) {
      // SAFETY: addKeys with a comma list returns an object keyed by those names.
      this.keys = keyboard.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,E,ENTER,SPACE,J', false) as Record<
        string,
        Phaser.Input.Keyboard.Key
      >
      // Phaser handles these keys first, then stops the browser from scrolling the page.
      // (A page-level preventDefault would hide them from Phaser altogether.)
      keyboard.addCapture('UP,DOWN,LEFT,RIGHT,SPACE')
      // Queue presses as events so a tap shorter than a frame still counts.
      keyboard.on('keydown', (event: KeyboardEvent) => {
        const action = KEY_ACTIONS.get(event.code)

        if (action && !event.repeat) this.pending.add(action)
      })
    }

    quest.setRegion(regionAt(this.pos))

    // A game saved inside the house resumes with the house standing and its visitors in place.
    if (inHouse(this.pos)) void this.cameHome()

    this.stopWatching = this.watchHouse()
    this.events.once('destroy', () => {
      this.mode.stop()
      this.stopWatching?.()
    })
  }

  override update(time: number) {
    const { controls, inputResumesAt } = quest.get()
    const pending = this.pending
    this.pending = new Set()
    const interact = pending.has('interact') || controls.interact > this.seen.interact
    const attack = pending.has('attack') || controls.attack > this.seen.attack
    const tapped = DIRS.find((dir) => pending.has(dir))
    this.seen = { interact: controls.interact, attack: controls.attack }
    this.syncOracle()

    if (quest.isPaused() || performance.now() < inputResumesAt) {
      this.idle()

      return
    }

    this.updateMonsters(time)
    this.updateTraveler(time)
    this.updateFish(time)
    this.callOutPhish(time)
    this.dismissItem()

    if (!this.mode.idle()) {
      // Keep a tap made mid-step so it happens when the step ends.
      for (const action of pending) this.pending.add(action)

      return
    }

    if (attack) {
      this.swing()

      return
    }

    if (interact) {
      this.interact()

      return
    }

    const dir = this.heldDir() ?? tapped

    if (dir) this.tryMove(dir)
    else this.idle()
  }

  private heldDir(): Dir | undefined {
    const held = DIRS.find((dir) => DIR_KEYS[dir].some((name) => this.keys[name]?.isDown))

    return held ?? quest.get().controls.dir ?? undefined
  }

  private idle() {
    if (this.mode.walking()) return
    this.player?.anims.stop()
    this.player?.setFrame(DOG_FRAME[this.dir])
  }

  private tileAt(p: Point) {
    return this.world.tiles[p.y]?.[p.x] ?? TILE.tree
  }

  /** Steps the fountain's four tiles through its frames, unless the player prefers less motion. */
  private animateFountain() {
    // Motion is opt-in: animate only when the player hasn't asked for less (or the browser can't say).
    if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return
    const { x, y } = this.world.fountain
    let frame = 0

    this.time.addEvent({
      delay: 180,
      loop: true,
      callback: () => {
        frame = (frame + 1) % FOUNTAIN_FRAMES
        const first = TILE.fountainTopLeft + frame * 4

        this.map?.putTileAt(first, x, y)
        this.map?.putTileAt(first + 1, x + 1, y)
        this.map?.putTileAt(first + 2, x, y + 1)
        this.map?.putTileAt(first + 3, x + 1, y + 1)
      },
    })
  }

  private setTile(p: Point, tile: number, draw = true) {
    const row = this.world.tiles[p.y]

    if (row) row[p.x] = tile

    if (draw) this.map?.putTileAt(tile, p.x, p.y)
  }

  private front(): Point {
    const step = STEP[this.dir]

    return { x: this.pos.x + step.x, y: this.pos.y + step.y }
  }

  private occupied(p: Point) {
    return (
      this.npcs.some((npc) => same(npc, p)) ||
      this.monsters.some((monster) => same(monster, p)) ||
      this.guards.some((guard) => same(guard.spot, p)) ||
      this.fish.some((fish) => same(fish, p)) ||
      this.phish.some((phish) => same(phish, p))
    )
  }

  private face(dir: Dir) {
    this.dir = dir

    if (!this.mode.walking()) this.player?.setFrame(DOG_FRAME[dir])
  }

  private tryMove(dir: Dir) {
    this.face(dir)
    const target = this.front()

    if (this.npcs.some((npc) => same(npc, target))) return

    if (this.phish.some((phish) => same(phish, target))) return

    const guard = this.guards.find((candidate) => same(candidate.spot, target))

    if (guard) {
      // Once a guard has stepped aside for the player, there's nothing more to ask them.
      if (this.openGate !== guard) this.askGuard(guard, target, guard.gate)

      return
    }

    const fish = this.fish.find((candidate) => same(candidate, target))

    if (fish) {
      this.catchFish(fish)

      return
    }

    if (this.monsters.some((monster) => same(monster, target))) {
      this.hurt(OPPOSITE[dir])

      return
    }

    const tile = this.tileAt(target)

    if (tile === TILE.gateClosed) {
      // From inside, the gate itself stands between the player and the guard outside. Walking out puts
      // the player back in the zone beyond, so the guard checks they still meet its rule.
      const gateGuard = this.guards.find((candidate) => same(candidate.gate, target))
      const beyond = gateGuard?.gate.exitZoneId

      if (gateGuard && beyond)
        this.askGuard(gateGuard, target, { zoneId: beyond, method: 'GET', action: 'enter' }, true)
      else if (gateGuard) this.letOut(gateGuard, target)

      return
    }

    if (tile === TILE.rock) {
      this.rockHint()

      return
    }

    if (tile === TILE.doorLocked) {
      this.lockedHint()

      return
    }

    if (tile === TILE.doorClosed) {
      this.openDoor()
      this.walk(target)

      return
    }

    if (PLAYER_TERRAIN.has(tile) || tile === TILE.gateOpen) this.walk(target)
  }

  private walk(target: Point) {
    const player = this.player

    if (!player) return
    this.mode.send({ type: 'WALK' })
    this.walkingTo = target

    if (this.tileAt(target) === TILE.water) sfx(this.tileAt(this.pos) === TILE.water ? 'paddle' : 'splash')
    this.swim(this.tileAt(target) === TILE.water)
    player.anims.play(`walk-${this.dir}`, true)
    this.tweens.add({
      targets: player,
      x: center(target.x),
      y: center(target.y),
      duration: STEP_MS,
      onComplete: () => this.arrive(target),
    })
  }

  private arrive(target: Point) {
    this.mode.send({ type: 'ARRIVED' })
    const leftWater = this.tileAt(this.pos) === TILE.water && this.tileAt(target) !== TILE.water
    this.pos = target
    this.walkingTo = undefined
    this.closeDoorBehind()

    if (leftWater) this.shakeOff()

    const passing = this.openGate

    if (passing && !same(passing.gate, target) && !same(passing.post, target)) {
      this.closeGate()
      sfx('gateClose')
    }

    const cameIn = !inHouse(this.previous) && inHouse(target)
    this.previous = target
    quest.progress({ x: target.x, y: target.y, dir: this.dir })
    quest.setRegion(regionAt(target))

    if (cameIn) void this.cameHome()

    if (same(target, HOUSE.mat) && !quest.get().letterRead && houseStage() !== 'unowned') readLetter()
  }

  /** A guard's post is the tile in front of their gate, on the outside, where the gate's sign stands. */
  private postOf(gate: Gate): Point {
    const sign = this.world.signs.find((candidate) => candidate.signId === gate.signId) ?? gate
    const roadRunsAcross = PLAYER_TERRAIN.has(this.tileAt({ x: gate.x - 1, y: gate.y }))

    if (roadRunsAcross) return { x: sign.x < gate.x ? gate.x - 1 : gate.x + 1, y: gate.y }

    return { x: gate.x, y: sign.y > gate.y ? gate.y + 1 : gate.y - 1 }
  }

  /**
   * Where a guard steps to let the player by: to one side of their post, away from the sign so it stays
   * in view, or the other side, or back along the road if the player is standing beside them.
   */
  private asideOf(guard: Guard): Point {
    const { gate, post } = guard
    const across = { x: post.y - gate.y, y: post.x - gate.x }
    const sign = this.world.signs.find((candidate) => candidate.signId === gate.signId) ?? post
    const awayFromSign = (sign.x - post.x) * across.x + (sign.y - post.y) * across.y > 0 ? -1 : 1

    const choices = [
      { x: post.x + across.x * awayFromSign, y: post.y + across.y * awayFromSign },
      { x: post.x - across.x * awayFromSign, y: post.y - across.y * awayFromSign },
      { x: post.x * 2 - gate.x, y: post.y * 2 - gate.y },
    ]

    const free = (p: Point) => WALKABLE.has(this.tileAt(p)) && !this.occupied(p) && !same(p, this.pos)

    return choices.find(free) ?? post
  }

  /** Asks Pomerium on the player's behalf; if it allows them, the guard steps aside and they walk on. */
  private askGuard(guard: Guard, target: Point, request: GateRequest, leaving = false) {
    this.mode.send({ type: 'GATE' })
    void enterGate(request, leaving).then((outcome) => {
      if (outcome !== 'allow') {
        this.mode.send({ type: 'GATE_DENIED' })

        // Only a player who was let in can be inside, so having no session there means the game lost it.
        if (leaving && outcome === 'signin') this.respawn(LOST_SESSION)

        return
      }

      sfx('gateOpen')
      const stepMs = this.letThrough(guard, true)
      this.time.delayedCall(stepMs, () => this.walk(target))
    })
  }

  /** Opens a gate for a player on its inside, who walks out once the guard has stepped aside. */
  private letOut(guard: Guard, target: Point) {
    this.mode.send({ type: 'GATE' })
    sfx('gateOpen')
    const stepMs = this.letThrough(guard, true)
    this.time.delayedCall(stepMs, () => this.walk(target))
  }

  /** Opens a gate and moves its guard aside; returns how long the guard takes to step out of the way. */
  private letThrough(guard: Guard, animate: boolean) {
    this.setTile(guard.gate, TILE.gateOpen)
    this.openGate = guard

    return this.moveGuard(guard, this.asideOf(guard), animate)
  }

  /** Closes the open gate behind the player, and its guard steps back to their post. */
  private closeGate() {
    const guard = this.openGate

    if (!guard) return
    this.openGate = undefined
    this.setTile(guard.gate, TILE.gateClosed)
    this.moveGuard(guard, guard.post, true)
  }

  /** A guard's short step, or a jump straight there when the player prefers less motion. */
  private moveGuard(guard: Guard, to: Point, animate: boolean) {
    guard.spot = to
    this.tweens.killTweensOf(guard.sprite)
    const motion = animate && matchMedia('(prefers-reduced-motion: no-preference)').matches

    if (!motion) {
      guard.sprite.setPosition(center(to.x), center(to.y))

      return 0
    }

    this.tweens.add({ targets: guard.sprite, x: center(to.x), y: center(to.y), duration: STEP_MS })

    return STEP_MS
  }

  private interact() {
    const target = this.front()
    const npc = this.npcs.find((candidate) => same(candidate, target))

    if (npc) {
      talk(npc.npcId)

      return
    }

    const phish = this.phish.find((candidate) => same(candidate, target))

    if (phish) {
      meetPhish(() => this.turnAway(phish))

      return
    }

    const fish = this.fish.find((candidate) => same(candidate, target))

    if (fish) {
      this.catchFish(fish)

      return
    }

    if (same(target, HOUSE.sign)) {
      readHouseSign()

      return
    }

    // Every sign stands beside a gate, and shows the route that gate asks.
    const sign = this.world.signs.find((candidate) => same(candidate, target))
    const signGate = sign && this.world.gates.find((candidate) => candidate.signId === sign.signId)

    if (signGate) {
      readSign(signGate)

      return
    }

    // Ask a guard (or face their gate from inside) and they recite the rule on the sign beside them.
    const guard = this.guards.find(
      (candidate) => same(candidate.spot, target) || same(candidate.gate, target),
    )

    if (guard) {
      readSign(guard.gate)

      return
    }

    const tile = this.tileAt(target)

    if (tile === TILE.chest && openChest()) {
      this.setTile(target, TILE.chestOpen)
      this.raiseItem(target, ITEM.swordSteel)
    }

    if (tile === TILE.shelf) void readBook(target.x)

    if (isFountain(tile)) drinkFromFountain()

    if (tile === TILE.anvil) readAnvil()

    if (tile === TILE.workbench) readWorkbench()

    if (tile === TILE.desk) quest.openHouseEditor()

    if (tile === TILE.bell) void ringBell()

    if (tile === TILE.tableBread || tile === TILE.tableCrumbs) readTable()

    if (tile === TILE.doormat) readLetter()

    if (tile === TILE.doorLocked) this.lockedHint()
  }

  private swing() {
    const sword = this.sword

    if (!sword) return
    this.mode.send({ type: 'SWING' })
    sfx(hasSteel() ? 'swingSteel' : 'swing')
    const target = this.front()
    const step = STEP[this.dir]
    const base = SWORD_ANGLE[this.dir]
    const frame = hasSteel() ? ITEM.swordSteel : ITEM.swordWood
    this.tweens.killTweensOf(sword)

    if (step.x !== 0) {
      // Facing sideways, a straight thrust in front of the dog reads well.
      sword
        .setFrame(frame)
        .setOrigin(0.5, 0.5)
        .setAngle(base)
        .setPosition(center(this.pos.x) + step.x * 11, center(this.pos.y))
        .setDepth(9)
        .setVisible(true)
      this.time.delayedCall(180, () => sword.setVisible(false))
    } else {
      // Facing up or down, the hand sits off to the side and the blade sweeps across the front,
      // so it never points out of the dog's middle.
      sword
        .setFrame(frame)
        .setOrigin(0.5, SWORD_GRIP)
        .setAngle(base + SWING.from)
        .setPosition(center(this.pos.x) - step.y * 6, center(this.pos.y) + step.y * 3)
        .setDepth(this.dir === 'up' ? 9 : 11)
        .setVisible(true)
      this.tweens.add({
        targets: sword,
        angle: { from: base + SWING.from, to: base + SWING.to },
        duration: SWING.ms,
        ease: 'Quad.easeOut',
        onComplete: () => this.time.delayedCall(40, () => sword.setVisible(false)),
      })
    }

    const monster = this.monsters.find((candidate) => same(candidate, target))

    if (monster) {
      this.hitMonster(monster, hasSteel() ? 2 : 1)

      return
    }

    if (this.phish.some((phish) => same(phish, target))) {
      quest.toast(
        "The robed figure steps back from your swing, smiling. You can't fight a phish, only refuse it.",
        'info',
      )

      return
    }

    if (this.tileAt(target) !== TILE.rock) return

    if (!hasSteel()) {
      sfx('clang')
      quest.toast('Clang. The wooden sword bounces off the cracked rock.', 'info')

      return
    }

    this.setTile(target, TILE.cobble)
    sfx('smash')
    this.shatterRock(target)
    quest.progress({ brokenRocks: [...quest.get().progress.brokenRocks, keyOf(target)] })
    quest.toast('The steel sword splits the rock.', 'info')
  }

  /** Fades the Oracle in beside the player when the store asks for him, and out again after. */
  private syncOracle() {
    const wanted = quest.get().oracleBeside
    const shown = this.visitingOracle

    if (wanted && !shown) {
      const spot = this.besidePlayer()

      const oracle = this.add
        .sprite(center(spot.x), center(spot.y) + 4, 'npcs', NPC_FRAME.oracle)
        .setDepth(10)
        .setAlpha(0)

      this.visitingOracle = oracle
      this.tweens.add({ targets: oracle, alpha: 1, y: center(spot.y), duration: 600, ease: 'Sine.easeOut' })

      return
    }

    if (!wanted && shown) {
      this.visitingOracle = undefined
      this.tweens.add({
        targets: shown,
        alpha: 0,
        y: shown.y - 6,
        duration: 500,
        onComplete: () => shown.destroy(),
      })
    }
  }

  /** A free tile next to the player, preferring their sides so the Oracle stands beside them. */
  private besidePlayer(): Point {
    const order: readonly Dir[] = ['right', 'left', 'down', 'up']

    for (const dir of order) {
      const spot = { x: this.pos.x + STEP[dir].x, y: this.pos.y + STEP[dir].y }

      if (!this.occupied(spot) && PLAYER_TERRAIN.has(this.tileAt(spot)) && this.tileAt(spot) !== TILE.water)
        return spot
    }

    return { x: this.pos.x + 1, y: this.pos.y }
  }

  /** The "item get" moment: the item rises out of the chest and hovers there. */
  private raiseItem(chest: Point, frame: number) {
    this.shownItem?.destroy()
    const item = this.add.image(center(chest.x), center(chest.y) - 2, 'items', frame).setDepth(11)

    this.shownItem = item
    this.tweens.add({ targets: item, y: center(chest.y) - 18, duration: 420, ease: 'Back.easeOut' })
    this.tweens.add({ targets: item, alpha: { from: 0, to: 1 }, duration: 200 })
  }

  /** Once the chest's dialog has been read, the item fades away. */
  private dismissItem() {
    const item = this.shownItem

    if (!item) return
    this.shownItem = undefined
    this.tweens.add({
      targets: item,
      alpha: 0,
      y: item.y - 6,
      duration: 300,
      onComplete: () => item.destroy(),
    })
  }

  /**
   * A wet dog's shake: a beat after climbing out, a fast side-to-side twist that builds and fades,
   * each swing flinging droplets the way he twists. The twist shifts the sprite's origin by whole
   * pixels, so it stays crisp and never fights a step that starts mid-shake.
   */
  private shakeOff() {
    this.shake?.remove()
    this.shake = this.time.delayedCall(SHAKE.delayMs, () => {
      const player = this.player

      if (!player || this.tileAt(this.pos) === TILE.water) return
      let swing = 0

      const next = () => {
        if (swing >= SHAKE.swings || this.tileAt(this.pos) === TILE.water) {
          player.setOrigin(0.5, 0.5).setScale(1)

          return
        }

        const side = swing % 2 === 0 ? 1 : -1
        // Strongest in the middle of the shake, gentle at the start and end.
        const strength = Math.sin(((swing + 1) / (SHAKE.swings + 1)) * Math.PI)
        swing++
        player.setOrigin(0.5 - (side * Math.round(SHAKE.reach * strength)) / T, 0.5)
        player.setScale(1 - 0.12 * strength, 1)
        sfx('shake')
        this.flingDroplets(side, strength)
        this.time.delayedCall(SHAKE.swingMs, next)
      }

      next()
    })
  }

  /** Droplets thrown off one swing of a shake: up and out to that side, then down to a tiny splash. */
  private flingDroplets(side: number, strength: number) {
    const player = this.player

    if (!player) return

    for (let i = 0; i < 2 + Math.round(strength * 3); i++) {
      const x = player.x + side * Phaser.Math.Between(2, 5)
      const y = player.y + Phaser.Math.Between(-5, 3)
      const color = Math.random() < 0.3 ? 0xffffff : Math.random() < 0.5 ? 0xbfe3ff : 0x5d9be0
      const drop = this.add.rectangle(x, y, 1, 1, color).setDepth(11)
      const dx = side * Phaser.Math.FloatBetween(6, 16) * (0.5 + strength)
      const fall = Phaser.Math.Between(4, 8)
      // y(t) = (1 + lift)t² − lift·t: flies up first, then gravity brings it down `fall` pixels below.
      const lift = Phaser.Math.FloatBetween(0.6, 1.4)

      this.tweens.add({
        targets: drop,
        x: { value: x + dx, ease: 'Quad.easeOut' },
        y: { value: y + fall, ease: (t: number) => (1 + lift) * t * t - lift * t },
        duration: Phaser.Math.Between(260, 380),
        onComplete: () => {
          drop.destroy()

          const splash = this.add
            .rectangle(x + dx, y + fall, 2, 1, 0x5d9be0)
            .setDepth(1)
            .setAlpha(0.8)

          this.tweens.add({ targets: splash, alpha: 0, duration: 250, onComplete: () => splash.destroy() })
        },
      })
    }
  }

  /** Bursts a broken rock into a handful of chunks that arc outward, tumble and fade. */
  private shatterRock(at: Point) {
    const colors = [0x9a9ca6, 0x7b7d86, 0x565862, 0xc3c5cd, 0x7b7d86]
    const pieces = 5

    this.cameras.main.shake(90, 0.002)

    for (let i = 0; i < pieces; i++) {
      const angle = -Math.PI / 2 + (i - (pieces - 1) / 2) * 0.75 + Phaser.Math.FloatBetween(-0.2, 0.2)
      const size = Phaser.Math.Between(3, 5)
      const x = center(at.x) + Phaser.Math.Between(-3, 3)
      const y = center(at.y) + Phaser.Math.Between(-2, 2)
      const color = colors[i % colors.length] ?? 0x7b7d86
      const chunk = this.add.rectangle(x, y, size, size, color).setStrokeStyle(1, 0x2d2e35).setDepth(11)
      const dx = Math.cos(angle) * Phaser.Math.Between(10, 16)
      // y(t) = (1 + a)t² − at: pops up, then gravity pulls it 6px below where it started.
      const lift = Phaser.Math.FloatBetween(3, 6)

      this.tweens.add({
        targets: chunk,
        x: { value: x + dx, ease: 'Quad.easeOut' },
        y: { value: y + 6, ease: (t: number) => (1 + lift) * t * t - lift * t },
        angle: Phaser.Math.Between(-200, 200),
        alpha: { value: 0, ease: 'Quad.easeIn' },
        duration: Phaser.Math.Between(350, 450),
        onComplete: () => chunk.destroy(),
      })
    }
  }

  /**
   * The house as its story stands: locked until the deed, then shut unless someone is in the doorway,
   * and the bread gone once the traveler ate it.
   */
  private dressHouse() {
    const stage = houseStage()
    const bread = stage === 'unowned' || stage === 'slimes' ? TILE.tableBread : TILE.tableCrumbs
    let door: number = this.inDoorway() ? TILE.door : TILE.doorClosed

    if (stage === 'unowned') door = TILE.doorLocked

    if (this.tileAt(HOUSE.door) !== door) this.setTile(HOUSE.door, door, Boolean(this.map))

    if (this.tileAt(HOUSE.table) !== bread) this.setTile(HOUSE.table, bread, Boolean(this.map))
  }

  /** Whether the player or the traveler is in the doorway, or stepping into it. */
  private inDoorway() {
    const traveler = this.travelerNpc()
    const player = this.walkingTo ?? this.pos

    return (
      same(player, HOUSE.door) ||
      same(this.pos, HOUSE.door) ||
      Boolean(traveler && same(traveler, HOUSE.door))
    )
  }

  /** The door opens for whoever walks through it. */
  private openDoor() {
    if (this.tileAt(HOUSE.door) !== TILE.doorClosed) return
    this.setTile(HOUSE.door, TILE.door)

    if (this.canSee(HOUSE.door)) sfx('doorOpen')
  }

  /** Once nobody is in the doorway, the door swings shut behind them. */
  private closeDoorBehind() {
    if (this.tileAt(HOUSE.door) !== TILE.door || this.inDoorway()) return
    this.setTile(HOUSE.door, TILE.doorClosed)

    if (this.canSee(HOUSE.door)) sfx('doorClose')
  }

  /** Whether a tile is on screen, so the player only hears what they can see. */
  private canSee(p: Point) {
    return this.cameras.main.worldView.contains(center(p.x), center(p.y))
  }

  /** Follows the house's story and its door rules: new rules mean the traveler may come or go. */
  private watchHouse() {
    let { houseStage: stage, progress, visits } = quest.get()
    let rules = progress.houseRules

    return quest.subscribe(() => {
      const next = quest.get()

      if (next.houseStage !== stage) {
        stage = next.houseStage
        this.dressHouse()
      }

      // Saving rules, or closing the bell's results, is when the traveler finds out if they're welcome.
      const closedVisits = visits !== null && next.visits === null
      visits = next.visits

      if (next.progress.houseRules !== rules || closedVisits) {
        rules = next.progress.houseRules
        void this.recheckTraveler()
      }
    })
  }

  /** Walking in puts the house up as a route; then whoever Pomerium allows is inside. */
  private async cameHome() {
    const house = await enterHouse()

    if (!house) return

    // A public house has a slime in it already: one walked in with no session at all.
    if (house.version === 'public' && !this.monsters.some((monster) => monster.home === 'house')) {
      if (await slimeKnocks()) this.letSlimeIn()
    }
  }

  private travelerNpc() {
    return this.npcs.find((npc) => npc.npcId === 'traveler')
  }

  /**
   * The traveler roams the fields. Every so often they walk to the player's door and knock: a real
   * request through Pomerium. If it lets them in, they sit down and eat the bread, then wander off again.
   */
  private updateTraveler(time: number) {
    const traveler = this.travelerNpc()
    const plan = this.traveler

    if (!traveler || plan.moving || plan.plan === 'knock') return
    plan.nextVisitAt ??= time + TRAVELER.firstVisitMs

    if (plan.plan === 'eat') {
      this.eatBread(traveler, time)

      return
    }

    if (time < plan.nextMoveAt) return
    plan.nextMoveAt = time + (plan.plan === 'roam' ? TRAVELER.roamMs * (1 + Math.random()) : 0)

    // The house has to be up as a route before there's a door to knock on.
    if (plan.plan === 'roam' && time >= plan.nextVisitAt && houseStage() !== 'unowned' && quest.get().house)
      this.planTraveler(
        'visit',
        this.pathFor(traveler, (p) => same(p, HOUSE.doorstep)),
      )

    if (plan.plan === 'roam') {
      this.roam(traveler)

      return
    }

    const next = plan.path[0]

    if (!next) {
      this.travelerArrived(time)

      return
    }

    if (!this.travelerCanEnter(next)) {
      this.travelerBlocked(traveler, time)

      return
    }

    plan.path.shift()
    plan.blocked = 0
    this.stepTraveler(traveler, next)
  }

  private planTraveler(plan: TravelerPlan, path: Point[] = []) {
    this.traveler.plan = plan
    this.traveler.path = path
    this.traveler.blocked = 0
  }

  /** A random step around the fields, staying out of the house and the water. */
  private roam(traveler: NpcSprite) {
    const dir = DIRS[Math.floor(Math.random() * DIRS.length)] ?? 'down'
    const target = { x: traveler.x + STEP[dir].x, y: traveler.y + STEP[dir].y }

    if (!inFields(target) || inHouse(target) || !WALKABLE.has(this.tileAt(target))) return

    if (this.travelerCanEnter(target)) this.stepTraveler(traveler, target)
  }

  /** Something is in the way: wait a moment, then look for another way round. */
  private travelerBlocked(traveler: Point, time: number) {
    const plan = this.traveler
    const goal = plan.path.at(-1)
    plan.nextMoveAt = time + 500
    plan.blocked++

    if (plan.blocked < TRAVELER.patience || !goal) return
    plan.blocked = 0
    const throughDoor = plan.plan !== 'visit'
    const goalTest = plan.plan === 'enter' ? atTable : (p: Point) => same(p, goal)
    const around = this.pathFor(traveler, goalTest, { throughDoor, avoid: true })

    if (around.length > 0) plan.path = around
    // Nowhere to sit: they leave rather than stand in the player's way.
    else if (plan.plan === 'enter')
      this.planTraveler('leave', this.pathFor(traveler, isDoorstep, { throughDoor }))
    else if (plan.plan === 'visit') this.giveUpVisit(time)
  }

  private giveUpVisit(time: number) {
    this.planTraveler('roam')
    this.traveler.nextVisitAt = time + TRAVELER.visitMs * (0.75 + Math.random() / 2)
  }

  private travelerArrived(time: number) {
    const plan = this.traveler.plan

    if (plan === 'visit') void this.travelerKnocks()

    if (plan === 'enter') {
      this.planTraveler('eat')
      this.traveler.doneEatingAt = time + TRAVELER.eatMs
      this.traveler.nextBiteAt = time
    }

    if (plan === 'leave') this.giveUpVisit(time)
  }

  /** On the doorstep, the traveler knocks: Pomerium decides whether they come in. */
  private async travelerKnocks() {
    this.planTraveler('knock')
    const welcome = await travelerWelcome()
    const traveler = this.travelerNpc()

    if (!traveler || this.traveler.plan !== 'knock') return

    if (welcome) {
      this.planTraveler('enter', this.pathFor(traveler, isSeat, { throughDoor: true }))

      return
    }

    this.giveUpVisit(this.time.now)

    if (this.near(HOUSE.door))
      quest.toast(
        'The traveler tries your door. No rule matches them, so Pomerium says no, and they wander off.',
        'allow',
      )
  }

  /** New door rules: a traveler already inside finds out whether they're still welcome. */
  private async recheckTraveler() {
    const plan = this.traveler.plan

    if (plan !== 'enter' && plan !== 'eat') return

    if (await travelerWelcome()) return
    const traveler = this.travelerNpc()

    if (!traveler) return
    this.planTraveler('leave', this.pathFor(traveler, isDoorstep, { throughDoor: true }))

    if (this.near(HOUSE.door))
      quest.toast('No rule lets the traveler in any more. They put down the bread and head out.', 'allow')
  }

  /** At the table, a bite every so often: a munch, and crumbs falling to the floor. */
  private eatBread(traveler: Point, time: number) {
    const plan = this.traveler

    if (time >= plan.doneEatingAt) {
      this.planTraveler('leave', this.pathFor(traveler, isDoorstep, { throughDoor: true }))

      return
    }

    if (time < plan.nextBiteAt) return
    plan.nextBiteAt = time + TRAVELER.biteMs * (0.8 + Math.random() * 0.4)

    if (!this.canSee(traveler)) return
    sfx('munch')
    this.dropCrumbs(traveler)
  }

  /** A few crumbs fall from the traveler's mouth, lie on the floor a while, then are gone. */
  private dropCrumbs(at: Point) {
    const motion = matchMedia('(prefers-reduced-motion: no-preference)').matches

    for (let i = 0; i < Phaser.Math.Between(2, 4); i++) {
      const color = CRUMB_COLORS[i % CRUMB_COLORS.length] ?? 0xc98a3c
      const x = center(at.x) + Phaser.Math.Between(-2, 2)
      const y = center(at.y) - 3
      const landX = x + Phaser.Math.Between(-6, 6)
      const landY = center(at.y) + Phaser.Math.Between(5, 7)
      const size = Phaser.Math.Between(1, 2)
      const crumb = this.add.rectangle(motion ? x : landX, motion ? y : landY, size, size, color).setDepth(11)
      const linger = CRUMB_LINGER_MS + Phaser.Math.Between(0, 1_000)

      if (!motion) {
        this.time.delayedCall(linger, () => crumb.destroy())
        continue
      }

      // y(t) = (1 + lift)t² − lift·t: a little hop out of the mouth, then down to the floor.
      const lift = Phaser.Math.FloatBetween(0.3, 0.8)

      this.tweens.add({
        targets: crumb,
        x: { value: landX, ease: 'Quad.easeOut' },
        y: { value: landY, ease: (t: number) => (1 + lift) * t * t - lift * t },
        duration: Phaser.Math.Between(220, 320),
        onComplete: () =>
          this.tweens.add({
            targets: crumb,
            alpha: 0,
            delay: linger,
            duration: 400,
            onComplete: () => crumb.destroy(),
          }),
      })
    }
  }

  private stepTraveler(traveler: NpcSprite, to: Point) {
    const plan = this.traveler
    plan.moving = true
    traveler.x = to.x
    traveler.y = to.y

    if (same(to, HOUSE.door)) this.openDoor()

    this.tweens.add({
      targets: traveler.sprite,
      x: center(to.x),
      y: center(to.y),
      duration: TRAVELER.stepMs,
      onComplete: () => {
        plan.moving = false
        this.closeDoorBehind()
      },
    })
  }

  /** A free tile the traveler could step onto: no one there, and the player isn't stepping onto it. */
  private travelerCanEnter(p: Point) {
    return !this.occupied(p) && !same(p, this.pos) && !(this.walkingTo && same(p, this.walkingTo))
  }

  /**
   * The traveler's shortest walk around the fields to a tile `goal` accepts, or none. Only on their way
   * in, once Pomerium has let them, or back out, do they go through the door.
   */
  private pathFor(
    from: Point,
    goal: (p: Point) => boolean,
    { throughDoor = false, avoid = false }: { throughDoor?: boolean; avoid?: boolean } = {},
  ): Point[] {
    const passable = (p: Point) => {
      const tile = this.tileAt(p)
      const door = throughDoor && (tile === TILE.door || tile === TILE.doorClosed)

      return inFields(p) && (WALKABLE.has(tile) || door) && (!avoid || this.travelerCanEnter(p))
    }

    const cameFrom = new Map<string, Point | null>([[keyOf(from), null]])
    const queue: Point[] = [from]

    for (let here = queue.shift(); here; here = queue.shift()) {
      if (goal(here)) {
        const path: Point[] = []

        for (
          let step: Point | null | undefined = here;
          step && !same(step, from);
          step = cameFrom.get(keyOf(step))
        )
          path.unshift(step)

        return path
      }

      for (const dir of DIRS) {
        const next = { x: here.x + STEP[dir].x, y: here.y + STEP[dir].y }

        if (cameFrom.has(keyOf(next)) || !passable(next)) continue
        cameFrom.set(keyOf(next), here)
        queue.push(next)
      }
    }

    return []
  }

  private near(p: Point, reach = 6) {
    return Math.abs(this.pos.x - p.x) + Math.abs(this.pos.y - p.y) <= reach
  }

  /** A field slime on the doorstep tries the door: a real request with no session. */
  private async slimeAtDoor(monster: Monster) {
    const now = performance.now()

    if (houseStage() === 'unowned' || now - this.slimeKnockedAt < SLIME_KNOCK_MS) return

    if (this.monsters.some((candidate) => candidate.home === 'house')) return
    this.slimeKnockedAt = now

    if (!quest.get().house) return

    if (await slimeKnocks()) {
      monster.sprite.destroy()
      this.monsters = this.monsters.filter((candidate) => candidate !== monster)
      this.letSlimeIn()

      if (inHouse(this.pos)) quest.toast('A slime squeezes in through your public door.', 'deny')

      return
    }

    if (Math.abs(this.pos.x - HOUSE.door.x) + Math.abs(this.pos.y - HOUSE.door.y) <= 6)
      quest.toast('A slime bounces off your door. With no session, it matches none of your rules.', 'allow')
  }

  /** A slime Pomerium let in appears just inside the door, and stays in the house. */
  private letSlimeIn() {
    const spot = this.occupied(SLIME_IN) || same(SLIME_IN, this.pos) ? HOUSE.mat : SLIME_IN

    this.monsters.push({
      kind: 'bot',
      home: 'house',
      sprite: this.add.sprite(center(spot.x), center(spot.y), 'items', MONSTER.bot.frame).play('bot'),
      x: spot.x,
      y: spot.y,
      hp: MONSTER.bot.hp,
      nextMoveAt: 0,
      moving: false,
    })
  }

  private lockedHint() {
    if (performance.now() - this.lastRockHint < 2000) return
    this.lastRockHint = performance.now()
    quest.toast('Locked. The sage in Hearth Village holds the deed to this house.', 'info')
  }

  private rockHint() {
    if (performance.now() - this.lastRockHint < 2000) return
    this.lastRockHint = performance.now()
    quest.toast('A cracked rock blocks the way. A stronger sword might break it.', 'info')
  }

  private hitMonster(monster: Monster, damage: number) {
    monster.hp -= damage
    buzz(15)
    sfx(monster.hp > 0 ? 'slimeHit' : 'slimePop')
    monster.sprite.setTint(0xffffff)
    this.time.delayedCall(120, () => monster.sprite.clearTint())

    if (monster.hp > 0) {
      const back = { x: monster.x + STEP[this.dir].x, y: monster.y + STEP[this.dir].y }

      if (this.monsterCanEnter(monster, back)) this.moveMonster(monster, back)

      return
    }

    monster.sprite.destroy()
    this.monsters = this.monsters.filter((candidate) => candidate !== monster)

    // An open house would be an endless supply of slimes, so the ones inside don't count for the Captain.
    if (monster.home === 'house') {
      quest.toast(
        quest.get().progress.houseRules
          ? 'Slime defeated. Your door rules keep the rest out.'
          : 'Slime defeated. But your door is public, so the next slime can walk right in.',
        'info',
      )

      return
    }

    quest.send({ type: 'MONSTER_DEFEATED', kind: monster.kind })
    const count = Math.min(defeated()[monster.kind], KNIGHT_QUOTA)
    quest.toast(
      `${MONSTER[monster.kind].name} defeated (${count} of ${KNIGHT_QUOTA} for the Captain)`,
      'info',
    )
  }

  /** Bot slimes walk the fields and stay out of the water; one let into the house stays inside. */
  private monsterCanEnter(monster: Monster, p: Point) {
    const area = monster.home === 'house' ? inHouse(p) : inFields(p) && !inHouse(p)

    return area && WALKABLE.has(this.tileAt(p)) && !this.occupied(p) && !same(p, this.pos)
  }

  private moveMonster(monster: Monster, target: Point) {
    monster.moving = true
    monster.x = target.x
    monster.y = target.y
    this.tweens.add({
      targets: monster.sprite,
      x: center(target.x),
      y: center(target.y),
      duration: 220,
      onComplete: () => {
        monster.moving = false
      },
    })
  }

  /** Each monster drifts at random, or heads for the player when near; stepping into the player bites. */
  private updateMonsters(time: number) {
    for (const monster of this.monsters) {
      if (monster.moving || time < monster.nextMoveAt) continue
      monster.nextMoveAt = time + 600 + Math.random() * 700
      const dx = this.pos.x - monster.x
      const dy = this.pos.y - monster.y
      const chase = Math.abs(dx) + Math.abs(dy) <= 5 && Math.random() < 0.6

      const dir: Dir = chase
        ? Math.abs(dx) > Math.abs(dy)
          ? dx > 0
            ? 'right'
            : 'left'
          : dy > 0
            ? 'down'
            : 'up'
        : (DIRS[Math.floor(Math.random() * DIRS.length)] ?? 'down')

      const target = { x: monster.x + STEP[dir].x, y: monster.y + STEP[dir].y }

      if (same(target, this.pos) && !this.mode.walking()) {
        this.hurt(dir)
        continue
      }

      if (this.monsterCanEnter(monster, target)) this.moveMonster(monster, target)

      if (monster.home === 'fields' && same(monster, HOUSE.doorstep)) void this.slimeAtDoor(monster)
    }
  }

  private inPond(p: Point, pond: Pond) {
    const inside = p.x >= pond.x0 && p.x <= pond.x1 && p.y >= pond.y0 && p.y <= pond.y1

    return inside && this.tileAt(p) === TILE.water && !this.occupied(p) && !same(p, this.pos)
  }

  /** Puts a fish on a free pond tile; if the dog and the other fish fill the pond, tries again shortly. */
  private spawnFish(pond: Pond) {
    const free: Point[] = []

    for (let y = pond.y0; y <= pond.y1; y++)
      for (let x = pond.x0; x <= pond.x1; x++) if (this.inPond({ x, y }, pond)) free.push({ x, y })
    const spot = free[Math.floor(Math.random() * free.length)]

    if (!spot) {
      this.time.delayedCall(2000, () => this.spawnFish(pond))

      return
    }

    const sprite = this.add.sprite(center(spot.x), center(spot.y), 'items', FISH_FRAME).play('fish')
    this.fish.push({ sprite, pond, x: spot.x, y: spot.y, nextMoveAt: 0, moving: false })
  }

  private catchFish(fish: Fish) {
    if (!eatFish()) return
    fish.sprite.destroy()
    this.fish = this.fish.filter((candidate) => candidate !== fish)
    this.time.delayedCall(FISH_RESPAWN_MS, () => this.spawnFish(fish.pond))
  }

  /** Fish drift around the pond at random, turning to face the way they swim. */
  private updateFish(time: number) {
    for (const fish of this.fish) {
      if (fish.moving || time < fish.nextMoveAt) continue
      fish.nextMoveAt = time + 800 + Math.random() * 1200
      const dir = DIRS[Math.floor(Math.random() * DIRS.length)] ?? 'left'
      const target = { x: fish.x + STEP[dir].x, y: fish.y + STEP[dir].y }

      if (!this.inPond(target, fish.pond)) continue

      if (dir === 'left' || dir === 'right') fish.sprite.setFlipX(dir === 'right')
      fish.moving = true
      fish.x = target.x
      fish.y = target.y
      this.tweens.add({
        targets: fish.sprite,
        x: center(target.x),
        y: center(target.y),
        duration: 400,
        onComplete: () => {
          fish.moving = false
        },
      })
    }
  }

  /** A phish the player refused gives up: it fades away and doesn't come back. */
  private turnAway(phish: Phish) {
    this.phish = this.phish.filter((candidate) => candidate !== phish)
    quest.progress({ phishTurnedAway: [...quest.get().progress.phishTurnedAway, phish.index] })
    this.tweens.add({
      targets: phish.sprite,
      alpha: 0,
      y: phish.sprite.y - 6,
      duration: 500,
      onComplete: () => phish.sprite.destroy(),
    })
  }

  /** A phish that spots the player nearby beckons them over, like a lure in the dark. */
  private callOutPhish(time: number) {
    for (const phish of this.phish) {
      const near = Math.abs(phish.x - this.pos.x) + Math.abs(phish.y - this.pos.y) <= PHISH_CALL.reach

      if (!near || time - phish.calledAt < PHISH_CALL.ms) continue
      phish.calledAt = time
      quest.toast('A robed figure waves you over: "Psst! Your session is about to expire!"', 'info')
    }
  }

  /** Takes a hit coming from `dir` (the direction the attacker was moving). */
  private hurt(dir: Dir) {
    if (this.mode.invulnerable() || !this.player) return
    this.mode.send({ type: 'HIT' })
    const hp = quest.get().hp - HIT_DAMAGE
    this.tweens.add({ targets: this.player, alpha: 0.2, duration: 90, yoyo: true, repeat: 4 })

    if (hp <= 0) {
      sfx('faint')
      this.respawn()

      return
    }

    sfx('bite')
    quest.setHp(hp)
    const back = { x: this.pos.x + STEP[dir].x, y: this.pos.y + STEP[dir].y }

    if (this.mode.idle() && PLAYER_TERRAIN.has(this.tileAt(back)) && !this.occupied(back)) {
      const facing = this.dir
      this.walk(back)
      this.dir = facing
    }
  }

  /** In water only the dog's head and collar show above the surface. */
  private swim(swimming: boolean) {
    if (swimming) this.player?.setCrop(0, 0, T, SWIM_DEPTH)
    else this.player?.setCrop()
  }

  private respawn(message = 'You wake up back in Hearth Village. Your identity and gear are still yours.') {
    this.closeGate()
    this.pos = this.world.spawn
    this.player?.setPosition(center(this.pos.x), center(this.pos.y))
    this.closeDoorBehind()
    this.swim(false)
    quest.setHp(MAX_HP)
    quest.progress({ x: this.pos.x, y: this.pos.y })
    quest.setRegion(regionAt(this.pos))
    quest.toast(message, 'info')
  }
}

declare global {
  var __quest: { readonly game: Phaser.Game; readonly quest: typeof quest } | undefined
}

export function startGame(parent: HTMLElement) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW.width,
    height: VIEW.height,
    pixelArt: true,
    // sound.ts makes every sound itself; Phaser would only open a second, unused AudioContext.
    audio: { noAudio: true },
    backgroundColor: '#14111f',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [KingdomScene],
  })

  // Handy for poking at state from devtools, and used by the end-to-end checks.
  globalThis.__quest = { game, quest }

  return game
}
