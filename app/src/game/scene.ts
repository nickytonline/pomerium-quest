// The overworld: tile map, grid movement, sword, monsters. Talking, reading and gates are
// delegated to story.ts; this file only moves things around and draws them.
import * as Phaser from 'phaser'
import { startPlayer } from './player-machine.ts'
import { SHEETS } from './sheets.ts'
import { KNIGHT_QUOTA, defeated, hasSteel, type MonsterKind } from './quest-machine.ts'
import { MAX_HP, buzz, quest, type Dir } from './store.ts'
import {
  drinkFromFountain,
  eatFish,
  enterGate,
  nightGate,
  openChest,
  readAnvil,
  readBook,
  readSign,
  readWorkbench,
  talk,
  writeLedger,
} from './story.ts'
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  NPC_FRAME,
  PLAYER_TERRAIN,
  FOUNTAIN_FRAMES,
  TILE,
  WALKABLE,
  isFountain,
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

/** Facing up or down, the sword pivots at its grip (row 14 of 16) and sweeps from the dog's side across the front. */
const SWORD_GRIP = 14 / 16
const SWING = { from: 100, to: -50, ms: 160 }
const ITEM = { swordWood: 0, swordSteel: 1 }

/** Rows of the dog's frame left above the waterline while swimming: head and collar. */
const SWIM_DEPTH = 11

/** A monster's bite takes a full heart (health counts half hearts). */
const HIT_DAMAGE = 2

/** Fish swim in the village pond, at most FISH_MAX at a time; a new one arrives FISH_RESPAWN_MS after one is eaten. */
const VILLAGE_POND = { x0: 2, y0: 25, x1: 4, y1: 27 }
const FISH_MAX = 2
const FISH_RESPAWN_MS = 30_000
const FISH_FRAME = 7

/** Monsters never leave the fields. */
const FIELDS = { x0: 1, y0: 1, x1: 15, y1: 16 }

/** Each kind's first frame in items.png (two frames each), hit points and name. */
const MONSTER: Record<MonsterKind, { readonly frame: number; readonly hp: number; readonly name: string }> = {
  bot: { frame: 3, hp: 2, name: 'Bot slime' },
  phish: { frame: 5, hp: 2, name: 'Phish' },
}

interface Fish {
  readonly sprite: Phaser.GameObjects.Sprite
  x: number
  y: number
  nextMoveAt: number
  moving: boolean
}

interface Monster {
  readonly kind: MonsterKind
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
  /** An item shown rising out of a chest until the player closes its dialog. */
  private shownItem: Phaser.GameObjects.Image | undefined
  private monsters: Monster[] = []
  private fish: Fish[] = []
  /** After a full dog turns down a fish, bumping it again stays quiet for a moment. */
  private fishRefusedUntil = 0
  private seen = { interact: 0, attack: 0 }
  private pending = new Set<Action>()
  private lastRockHint = 0

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

    for (const npc of this.world.npcs)
      this.add.sprite(center(npc.x), center(npc.y), 'npcs', NPC_FRAME[npc.npcId])

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
      x: spot.x,
      y: spot.y,
      hp: MONSTER[kind].hp,
      nextMoveAt: 0,
      moving: false,
    })

    this.monsters = [...this.world.bots.map(spawn('bot')), ...this.world.phish.map(spawn('phish'))]

    this.anims.create({
      key: 'fish',
      frames: this.anims.generateFrameNumbers('items', { frames: [FISH_FRAME, FISH_FRAME + 1] }),
      frameRate: 4,
      repeat: -1,
    })

    for (let i = 0; i < FISH_MAX; i++) this.spawnFish()

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

    this.updateMonsters(time)
    this.updateFish(time)
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
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
      this.world.npcs.some((npc) => same(npc, p)) ||
      this.monsters.some((monster) => same(monster, p)) ||
      this.fish.some((fish) => same(fish, p))
    )
  }

  private face(dir: Dir) {
    this.dir = dir

    if (!this.mode.walking()) this.player?.setFrame(DOG_FRAME[dir])
  }

  private tryMove(dir: Dir) {
    this.face(dir)
    const target = this.front()

    if (this.world.npcs.some((npc) => same(npc, target))) return

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

    if (PLAYER_TERRAIN.has(tile) || tile === TILE.gateOpen) this.walk(target)
  }

  private walk(target: Point) {
    const player = this.player

    if (!player) return
    this.mode.send({ type: 'WALK' })
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

    const fish = this.fish.find((candidate) => same(candidate, target))

    if (fish) {
      this.catchFish(fish)

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

    if (tile === TILE.chest && openChest()) {
      this.setTile(target, TILE.chestOpen)
      this.raiseItem(target, ITEM.swordSteel)
    }

    if (tile === TILE.shelf) void readBook(target.x)

    if (tile === TILE.lectern) void writeLedger()

    if (tile === TILE.nightGate) nightGate()

    if (isFountain(tile)) drinkFromFountain()

    if (tile === TILE.anvil) readAnvil()

    if (tile === TILE.workbench) readWorkbench()
  }

  private swing() {
    const sword = this.sword

    if (!sword) return
    this.mode.send({ type: 'SWING' })
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

    if (this.tileAt(target) !== TILE.rock) return

    if (!hasSteel()) {
      quest.toast('Clang. The wooden sword bounces off the cracked rock.', 'info')

      return
    }

    this.setTile(target, TILE.cobble)
    this.shatterRock(target)
    quest.progress({ brokenRocks: [...quest.get().progress.brokenRocks, keyOf(target)] })
    quest.toast('The steel sword splits the rock.', 'info')
  }

  /** The "item get" moment: the item rises out of the chest and hovers there. */
  private raiseItem(chest: Point, frame: number) {
    this.shownItem?.destroy()
    const item = this.add.image(center(chest.x), center(chest.y) - 2, 'items', frame).setDepth(11)

    this.shownItem = item
    this.tweens.add({ targets: item, y: center(chest.y) - 14, duration: 420, ease: 'Back.easeOut' })
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

  private rockHint() {
    if (performance.now() - this.lastRockHint < 2000) return
    this.lastRockHint = performance.now()
    quest.toast('A cracked rock blocks the way. A stronger sword might break it.', 'info')
  }

  private hitMonster(monster: Monster, damage: number) {
    monster.hp -= damage
    buzz(15)
    monster.sprite.setTint(0xffffff)
    this.time.delayedCall(120, () => monster.sprite.clearTint())

    if (monster.hp > 0) {
      const back = { x: monster.x + STEP[this.dir].x, y: monster.y + STEP[this.dir].y }

      if (this.monsterCanEnter(monster, back)) this.moveMonster(monster, back)

      return
    }

    monster.sprite.destroy()
    this.monsters = this.monsters.filter((candidate) => candidate !== monster)
    quest.send({ type: 'MONSTER_DEFEATED', kind: monster.kind })
    const count = Math.min(defeated()[monster.kind], KNIGHT_QUOTA)
    quest.toast(
      `${MONSTER[monster.kind].name} defeated (${count} of ${KNIGHT_QUOTA} for the Captain)`,
      'info',
    )
  }

  /** Bot slimes walk the fields; phish stay in the pond. */
  private monsterCanEnter(monster: Monster, p: Point) {
    const inFields = p.x >= FIELDS.x0 && p.x <= FIELDS.x1 && p.y >= FIELDS.y0 && p.y <= FIELDS.y1
    const tile = this.tileAt(p)
    const terrain = monster.kind === 'phish' ? tile === TILE.water : WALKABLE.has(tile)

    return inFields && terrain && !this.occupied(p) && !same(p, this.pos)
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
    }
  }

  private inPond(p: Point) {
    const inside =
      p.x >= VILLAGE_POND.x0 && p.x <= VILLAGE_POND.x1 && p.y >= VILLAGE_POND.y0 && p.y <= VILLAGE_POND.y1

    return inside && this.tileAt(p) === TILE.water && !this.occupied(p) && !same(p, this.pos)
  }

  /** Puts a fish on a free pond tile; if the dog and the other fish fill the pond, tries again shortly. */
  private spawnFish() {
    const free: Point[] = []

    for (let y = VILLAGE_POND.y0; y <= VILLAGE_POND.y1; y++)
      for (let x = VILLAGE_POND.x0; x <= VILLAGE_POND.x1; x++) if (this.inPond({ x, y })) free.push({ x, y })
    const spot = free[Math.floor(Math.random() * free.length)]

    if (!spot) {
      this.time.delayedCall(2000, () => this.spawnFish())

      return
    }

    const sprite = this.add.sprite(center(spot.x), center(spot.y), 'items', FISH_FRAME).play('fish')
    this.fish.push({ sprite, x: spot.x, y: spot.y, nextMoveAt: 0, moving: false })
  }

  private catchFish(fish: Fish) {
    if (performance.now() < this.fishRefusedUntil) return

    if (!eatFish()) {
      this.fishRefusedUntil = performance.now() + 2000

      return
    }

    fish.sprite.destroy()
    this.fish = this.fish.filter((candidate) => candidate !== fish)
    this.time.delayedCall(FISH_RESPAWN_MS, () => this.spawnFish())
  }

  /** Fish drift around the pond at random, turning to face the way they swim. */
  private updateFish(time: number) {
    for (const fish of this.fish) {
      if (fish.moving || time < fish.nextMoveAt) continue
      fish.nextMoveAt = time + 800 + Math.random() * 1200
      const dir = DIRS[Math.floor(Math.random() * DIRS.length)] ?? 'left'
      const target = { x: fish.x + STEP[dir].x, y: fish.y + STEP[dir].y }

      if (!this.inPond(target)) continue

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

  /** Takes a hit coming from `dir` (the direction the attacker was moving). */
  private hurt(dir: Dir) {
    if (this.mode.invulnerable() || !this.player) return
    this.mode.send({ type: 'HIT' })
    const hp = quest.get().hp - HIT_DAMAGE
    this.tweens.add({ targets: this.player, alpha: 0.2, duration: 90, yoyo: true, repeat: 4 })

    if (hp <= 0) {
      this.respawn()

      return
    }

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

  private respawn() {
    this.pos = this.world.spawn
    this.player?.setPosition(center(this.pos.x), center(this.pos.y))
    this.swim(false)
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
