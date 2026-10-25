// The overworld: tile map, grid movement, sword, slimes. Talking, reading and gates are
// delegated to story.ts; this file only moves things around and draws them.
import * as Phaser from 'phaser'
import { startPlayer } from './player-machine.ts'
import { hasSteel, xp } from './quest-machine.ts'
import { MAX_HP, quest, type Dir } from './store.ts'
import { enterGate, nightGate, openChest, readBook, readSign, talk, writeLedger } from './story.ts'
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  NPC_FRAME,
  TILE,
  WALKABLE,
  buildWorld,
  regionAt,
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
const ITEM = { swordWood: 0, swordSteel: 1, slime: 3 }
const SLIME_HP = 2
const SLIME_RANGE = { x0: 1, y0: 1, x1: 15, y1: 16 }

interface Slime {
  readonly sprite: Phaser.GameObjects.Sprite
  x: number
  y: number
  hp: number
  nextMoveAt: number
  moving: boolean
}

const center = (tile: number) => tile * T + T / 2
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y
const keyOf = (p: Point) => `${p.x},${p.y}`

export class KingdomScene extends Phaser.Scene {
  private readonly world = buildWorld()
  private map: Phaser.Tilemaps.Tilemap | undefined
  private player: Phaser.GameObjects.Sprite | undefined
  private sword: Phaser.GameObjects.Image | undefined
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {}
  private pos: Point = { x: 0, y: 0 }
  private dir: Dir = 'down'
  private readonly mode = startPlayer()
  private openGate: Point | undefined
  private slimes: Slime[] = []
  private seen = { interact: 0, attack: 0 }
  private pending = new Set<Action>()
  private lastRockHint = 0

  constructor() {
    super('kingdom')
  }

  preload() {
    const frames = { frameWidth: T, frameHeight: T }
    this.load.spritesheet('dog', '/assets/dog.png', frames)
    this.load.spritesheet('items', '/assets/items.png', frames)
    this.load.spritesheet('npcs', '/assets/npcs.png', frames)
    this.load.image('tiles', '/assets/tiles.png')
  }

  create() {
    const { progress, controls } = quest.get()
    this.pos = { x: progress.x, y: progress.y }
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

    for (const npc of this.world.npcs)
      this.add.sprite(center(npc.x), center(npc.y), 'npcs', NPC_FRAME[npc.npcId])

    this.anims.create({
      key: 'slime',
      frames: this.anims.generateFrameNumbers('items', { frames: [ITEM.slime, ITEM.slime + 1] }),
      frameRate: 3,
      repeat: -1,
    })
    this.slimes = this.world.slimes.map((spot) => ({
      sprite: this.add.sprite(center(spot.x), center(spot.y), 'items', ITEM.slime).play('slime'),
      x: spot.x,
      y: spot.y,
      hp: SLIME_HP,
      nextMoveAt: 0,
      moving: false,
    }))

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
    this.events.once('destroy', () => this.mode.stop())
  }

  override update(time: number) {
    const { controls, inputResumesAt } = quest.get()
    const pending = this.pending
    this.pending = new Set()
    const interact = pending.has('interact') || controls.interact > this.seen.interact
    const attack = pending.has('attack') || controls.attack > this.seen.attack
    const tapped = DIRS.find((dir) => pending.has(dir))
    this.seen = { interact: controls.interact, attack: controls.attack }

    if (quest.isPaused() || performance.now() < inputResumesAt) {
      this.idle()

      return
    }

    this.updateSlimes(time)

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
    return this.world.npcs.some((npc) => same(npc, p)) || this.slimes.some((slime) => same(slime, p))
  }

  private face(dir: Dir) {
    this.dir = dir

    if (!this.mode.walking()) this.player?.setFrame(DOG_FRAME[dir])
  }

  private tryMove(dir: Dir) {
    this.face(dir)
    const target = this.front()

    if (this.world.npcs.some((npc) => same(npc, target))) return

    if (this.slimes.some((slime) => same(slime, target))) {
      this.hurt(OPPOSITE[dir])

      return
    }

    const tile = this.tileAt(target)

    if (tile === TILE.gateClosed) {
      const gate = this.world.gates.find((candidate) => same(candidate, target))

      if (!gate) return
      this.mode.send({ type: 'GATE' })
      void enterGate(gate.zoneId).then((allowed) => {
        if (!allowed) {
          this.mode.send({ type: 'GATE_DENIED' })

          return
        }

        this.setTile(target, TILE.gateOpen)
        this.openGate = target
        this.walk(target)
      })

      return
    }

    if (tile === TILE.nightGate) {
      nightGate()

      return
    }

    if (tile === TILE.rock) {
      this.rockHint()

      return
    }

    if (WALKABLE.has(tile) || tile === TILE.gateOpen) this.walk(target)
  }

  private walk(target: Point) {
    const player = this.player

    if (!player) return
    this.mode.send({ type: 'WALK' })
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
    this.pos = target

    if (this.openGate && !same(this.openGate, target)) {
      this.setTile(this.openGate, TILE.gateClosed)
      this.openGate = undefined
    }

    quest.progress({ x: target.x, y: target.y, dir: this.dir })
    quest.setRegion(regionAt(target))
  }

  private interact() {
    const target = this.front()
    const npc = this.world.npcs.find((candidate) => same(candidate, target))

    if (npc) {
      talk(npc.npcId)

      return
    }

    const sign = this.world.signs.find((candidate) => same(candidate, target))

    if (sign) {
      readSign(sign.signId)

      return
    }

    const gate = this.world.gates.find((candidate) => same(candidate, target))

    if (gate) {
      readSign(gate.zoneId)

      return
    }

    const tile = this.tileAt(target)

    if (tile === TILE.chest && openChest()) this.setTile(target, TILE.chestOpen)

    if (tile === TILE.shelf) void readBook(target.x)

    if (tile === TILE.lectern) void writeLedger()

    if (tile === TILE.nightGate) nightGate()
  }

  private swing() {
    const sword = this.sword

    if (!sword) return
    this.mode.send({ type: 'SWING' })
    const target = this.front()
    sword
      .setFrame(hasSteel() ? ITEM.swordSteel : ITEM.swordWood)
      .setAngle(SWORD_ANGLE[this.dir])
      .setPosition(center(this.pos.x) + STEP[this.dir].x * 11, center(this.pos.y) + STEP[this.dir].y * 11)
      .setVisible(true)
    this.time.delayedCall(180, () => sword.setVisible(false))

    const slime = this.slimes.find((candidate) => same(candidate, target))

    if (slime) {
      this.hitSlime(slime, hasSteel() ? 2 : 1)

      return
    }

    if (this.tileAt(target) !== TILE.rock) return

    if (!hasSteel()) {
      quest.toast('Clang. The wooden sword bounces off the cracked rock.', 'info')

      return
    }

    this.setTile(target, TILE.cobble)
    quest.progress({ brokenRocks: [...quest.get().progress.brokenRocks, keyOf(target)] })
    quest.toast('The steel sword splits the rock.', 'info')
  }

  private rockHint() {
    if (performance.now() - this.lastRockHint < 2000) return
    this.lastRockHint = performance.now()
    quest.toast('A cracked rock blocks the way. A stronger sword might break it.', 'info')
  }

  private hitSlime(slime: Slime, damage: number) {
    slime.hp -= damage
    slime.sprite.setTint(0xffffff)
    this.time.delayedCall(120, () => slime.sprite.clearTint())

    if (slime.hp > 0) {
      const back = { x: slime.x + STEP[this.dir].x, y: slime.y + STEP[this.dir].y }

      if (this.slimeCanEnter(back)) this.moveSlime(slime, back)

      return
    }

    slime.sprite.destroy()
    this.slimes = this.slimes.filter((candidate) => candidate !== slime)
    quest.send({ type: 'SLIME_DEFEATED' })
    quest.toast(`Slime defeated (${Math.min(xp(), 3)} of 3 for the Captain)`, 'info')
  }

  private slimeCanEnter(p: Point) {
    const inRange =
      p.x >= SLIME_RANGE.x0 && p.x <= SLIME_RANGE.x1 && p.y >= SLIME_RANGE.y0 && p.y <= SLIME_RANGE.y1

    return inRange && WALKABLE.has(this.tileAt(p)) && !this.occupied(p) && !same(p, this.pos)
  }

  private moveSlime(slime: Slime, target: Point) {
    slime.moving = true
    slime.x = target.x
    slime.y = target.y
    this.tweens.add({
      targets: slime.sprite,
      x: center(target.x),
      y: center(target.y),
      duration: 220,
      onComplete: () => {
        slime.moving = false
      },
    })
  }

  private updateSlimes(time: number) {
    for (const slime of this.slimes) {
      if (slime.moving || time < slime.nextMoveAt) continue
      slime.nextMoveAt = time + 600 + Math.random() * 700
      const dx = this.pos.x - slime.x
      const dy = this.pos.y - slime.y
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

      const target = { x: slime.x + STEP[dir].x, y: slime.y + STEP[dir].y }

      if (same(target, this.pos) && !this.mode.walking()) {
        this.hurt(dir)
        continue
      }

      if (this.slimeCanEnter(target)) this.moveSlime(slime, target)
    }
  }

  /** Takes a hit coming from `dir` (the direction the attacker was moving). */
  private hurt(dir: Dir) {
    if (this.mode.invulnerable() || !this.player) return
    this.mode.send({ type: 'HIT' })
    const hp = quest.get().hp - 1
    this.tweens.add({ targets: this.player, alpha: 0.2, duration: 90, yoyo: true, repeat: 4 })

    if (hp <= 0) {
      this.respawn()

      return
    }

    quest.setHp(hp)
    const back = { x: this.pos.x + STEP[dir].x, y: this.pos.y + STEP[dir].y }

    if (this.mode.idle() && WALKABLE.has(this.tileAt(back)) && !this.occupied(back)) {
      const facing = this.dir
      this.walk(back)
      this.dir = facing
    }
  }

  private respawn() {
    this.pos = this.world.spawn
    this.player?.setPosition(center(this.pos.x), center(this.pos.y))
    quest.setHp(MAX_HP)
    quest.progress({ x: this.pos.x, y: this.pos.y })
    quest.setRegion(regionAt(this.pos))
    quest.toast('You wake up at home. Your identity and gear are still yours.', 'info')
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
    backgroundColor: '#14111f',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [KingdomScene],
  })

  // Handy for poking at state from devtools, and used by the end-to-end checks.
  globalThis.__quest = { game, quest }

  return game
}
