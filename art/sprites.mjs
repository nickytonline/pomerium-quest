// Pixel-art source for Pomerium Quest. Each sprite is a 16x16 grid of palette keys.
// Run: node art/sprites.mjs  → writes app/public/assets/*.png and art/out/ previews
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tiles } from './tiles.mjs'
import { deflateSync } from 'node:zlib'

const PALETTE = {
  '.': null,
  K: '#241a2e', // outline
  O: '#ef8f55', // fur
  L: '#fbd3a6', // cream fur
  S: '#c8643c', // fur shadow
  G: '#e9b44c', // gold (studs)
  M: '#ff4fb8', // tongue
  W: '#ffffff', // glint
  N: '#3a2630', // nose
  J: '#2a2950', // jacket
  H: '#4b55a0', // jacket highlight
  B: '#b5813e', // wood
  D: '#7a5126', // dark wood
  I: '#dfe7f1', // steel
  E: '#8d97a8', // steel shadow
  b: '#8fa3c7', // bot slime steel
  h: '#d6e2f5', // bot slime highlight
  z: '#1b1530', // bot slime visor
  r: '#ff5d73', // bot slime LEDs
  f: '#6a4fd8', // phish
  p: '#ff7ac8', // phish fins
  y: '#ffd86b', // phish lure
  U: '#ffb27a', // fur highlight
  Y: '#e3b48a', // cream shadow
  Q: '#0b0910', // sunglasses black
  q: '#4d4866', // sunglasses lens sheen
}

const HEAD_DOWN = [
  '...K........K...',
  '..KSK......KSK..',
  '..KSOKKKKKKOSK..',
  '.KOOOOUUUUOOOOK.',
  '.KOQQQQQQQQQQOK.',
  '.KQQQWQOOQWQQQK.',
  '.KOKQQKLLKQQKOK.',
  '.KSOLLNNNNLLOSK.',
  '..KSLLLNNLLLSK..',
  '...KSLKMMKLSK...',
  '..KJJKLMMLKJJK..',
  '.KJHJJKLLKJJHJK.',
  '.KJHGJJKKJJGHJK.',
  '.KSKJJJJJJJJKSK.',
  '..KKJJJJJJJJKK..',
]

const HEAD_UP = [
  '...K........K...',
  '..KOK......KOK..',
  '..KOOKKKKKKOOK..',
  '.KOOOOOOOOOOOOK.',
  '.KOOUOOOOOOUOOK.',
  '.KQOOOOOOOOOOQK.',
  '.KSOOOOOOOOOOSK.',
  '.KSSOOOOOOOOSSK.',
  '..KSSOOOOOOSSK..',
  '...KKSSSSSSKK...',
  '..KJJJKUUKJJJK..',
  '.KJHJKUUUUKJHJK.',
  '.KJHJKUOOUKJHJK.',
  '.KSKJJKUUKJJKSK.',
  '..KKJJJKKJJJKK..',
]

const HEAD_RIGHT = [
  '.....K..........',
  '....KSK.KK......',
  '....KSOKUUK.....',
  '...KOOOUUUUK....',
  '...KOOOOQQQQQK..',
  '..KOOQQQQQWQKKKK',
  '..KOOOOOQqqQOOON',
  '..KSOOOOOQQKLLLN',
  '..KSOOOLLLLLKKKK',
  '...KSOLLLLLLK...',
  'KK..KJJLLLJK....',
  'KUKKJHJJLLJK....',
  'KOUKJHJJJJJK....',
  '.KSKJJGJJJJK....',
  '..KKJJJJJJJK....',
]

const FRONT_FEET = { idle: '...KOK....KOK...', a: '...KOK.....KK...', b: '....KK....KOK...' }
const SIDE_FEET = { idle: '....KOK..KOK....', a: '.....KOKKOK.....', b: '...KOK....KOK...' }

const withFeet = (body, feet) => [...body, feet]
const mirror = (rows) => rows.map((r) => [...r].reverse().join(''))

const dog = {
  down: ['idle', 'a', 'b'].map((f) => withFeet(HEAD_DOWN, FRONT_FEET[f])),
  up: ['idle', 'a', 'b'].map((f) => withFeet(HEAD_UP, FRONT_FEET[f])),
  right: ['idle', 'a', 'b'].map((f) => withFeet(HEAD_RIGHT, SIDE_FEET[f])),
}

dog.left = dog.right.map(mirror)

const SWORD_WOOD = [
  '.......KK.......',
  '......KBBK......',
  '......KBDK......',
  '......KBDK......',
  '......KBDK......',
  '......KBDK......',
  '......KBDK......',
  '......KBDK......',
  '......KBDK......',
  '......KBDK......',
  '....KKKKKKKK....',
  '....KDDDDDDK....',
  '....KKKDDKKK....',
  '......KDDK......',
  '......KGGK......',
  '.......KK.......',
]

const SWORD_STEEL = SWORD_WOOD.map((r, i) =>
  i < 10 ? r.replace(/B/g, 'I').replace(/D/g, 'E') : r.replace(/D/g, 'G'),
)

const SHIELD_WOOD = [
  '................',
  '...KKKKKKKKKK...',
  '..KBBBBDDBBBBK..',
  '..KBBBBDDBBBBK..',
  '..KBBBBDDBBBBK..',
  '..KDDDDGGDDDDK..',
  '..KDDDDGGDDDDK..',
  '..KBBBBDDBBBBK..',
  '..KBBBBDDBBBBK..',
  '...KBBBDDBBBK...',
  '...KBBBDDBBBK...',
  '....KBBDDBBK....',
  '.....KBDDBK.....',
  '......KDDK......',
  '.......KK.......',
  '................',
]

// A slime with a steel shell, an antenna and an LED visor: mindless, and at every gate at once.
const BOT_SLIME = [
  [
    '................',
    '.......KK.......',
    '......KrrK......',
    '.......KK.......',
    '.......KK.......',
    '......KKKK......',
    '....KKbbbbKK....',
    '...KbhhbbbbbK...',
    '..KbhhbbbbbbbK..',
    '..KbzzzzzzzzbK..',
    '.KbbzrzzzzrzbbK.',
    '.KbbzzzzzzzzbbK.',
    '.KbbbbbbbbbbbbK.',
    '..KKbbbbbbbbKK..',
    '....KKKKKKKK....',
    '................',
  ],
  [
    '................',
    '................',
    '................',
    '.......KK.......',
    '......KzzK......',
    '.......KK.......',
    '.......KK.......',
    '.....KKKKKK.....',
    '...KKbhhbbbKK...',
    '..KbhhbbbbbbbK..',
    '.KbbzzzzzzzzbbK.',
    'KbbbzrzzzzrzbbbK',
    'KbbbbbbbbbbbbbbK',
    '.KKbbbbbbbbbbKK.',
    '...KKKKKKKKKK...',
    '................',
  ],
]

// An anglerfish dangling a friendly-looking light: bait for anyone who trusts it.
const PHISH_LIT = [
  '................',
  '.....KKK........',
  '....K...K.......',
  '..KK....K.......',
  '.KyyK...K.......',
  '.KyyK..KKKKK..KK',
  '..KK.KffffffKKpK',
  '....KfWKffffKppK',
  '...KfffffffffppK',
  '...KWKWKffffffpK',
  '...KfWfWfffffKpK',
  '....KfffffffK.KK',
  '.....KKKKKKK....',
  '................',
  '................',
  '................',
]

const PHISH = [PHISH_LIT, PHISH_LIT.map((r, i) => (i === 4 || i === 5 ? r.replace(/y/g, 'W') : r))]

// ---- tiny PNG encoder ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n

  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1

  return c
})

const crc32 = (buf) => {
  let c = -1

  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8)

  return (c ^ -1) >>> 0
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))

  return Buffer.concat([len, td, crc])
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)

  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

// Each NPC is drawn once, facing down, with a silhouette of its own (hood, bun, hat brim, plume,
// bald dome) so they read apart before their colors do. Keys are local to each palette.
const NPCS = {
  // Elder who wakes you: white bun, round glasses, plum shawl.
  sage: {
    palette: {
      A: '#ececf2',
      a: '#b9b9c8',
      F: '#e8b98a',
      E: '#9fb4d8',
      B: '#9b4f6e',
      C: '#6e3550',
      D: '#5f7f6a',
      d: '#465e4e',
    },
    rows: [
      '......KKKK......',
      '.....KAAAAK.....',
      '....KKAaaAKK....',
      '...KAAAAAAAAK...',
      '...KAFFFFFFAK...',
      '...KAEKFFKEAK...',
      '...KAFFFFFFAK...',
      '....KFFKKFFK....',
      '...KBBKFFKBBK...',
      '..KBBBBBBBBBK...',
      '..KCBBBCCBBBK...',
      '..KDDDDDDDDDK...',
      '..KDDDDDDDDDK...',
      '...KdddddddK....',
      '...KKKK.KKKK....',
      '................',
    ],
  },
  // The identity provider: tall starred hood, long white beard, a glowing orb.
  oracle: {
    palette: {
      A: '#5b2fb0',
      a: '#8b5cf6',
      F: '#f6d3b3',
      W: '#f4f4f8',
      w: '#a9a9bd',
      G: '#e9b44c',
      o: '#7ef0ff',
    },
    rows: [
      '.......KK.......',
      '......KaAK......',
      '.....KaAGAK.....',
      '....KaAAAAAK....',
      '...KAFKFFKFAK...',
      '...KAFFFFFFAK...',
      '...KAWWFFWWAK...',
      '..KAWWWKKWWWAK..',
      '..KAKWWwWWWKAK..',
      '..KAaKWwWWKaAK..',
      '.KooKaKWwKaaAK..',
      '.KooKAaKKaAaAK..',
      '..KKKAAAAAAaK...',
      '...KAAAAAAAAK...',
      '...KKKKKKKKKK...',
      '................',
    ],
  },
  // wanderer@outlands.net: wide dusty hat, stubble, a patched cloak in outland greens.
  traveler: {
    palette: {
      A: '#8a6a45',
      a: '#5a4430',
      F: '#c68642',
      X: '#8f5a2c',
      B: '#4f7a3a',
      C: '#38582a',
      s: '#6b4a2b',
      P: '#c9a46a',
    },
    rows: [
      '................',
      '.....KKKKKK.....',
      '....KAAAAAAK....',
      '....KaaaaaaK....',
      '.KAAAAAAAAAAAAK.',
      '..KKKFFFFFFKKK..',
      '....KFKFFKFK....',
      '....KFFFFFFK....',
      '....KXXFFXXK....',
      '...KBsKXXKBBK...',
      '..KBBBsBBBBBBK..',
      '..KFBBBsBBPBFK..',
      '...KBBBBsBBBK...',
      '...KCCCKKCCCK...',
      '...KKKK..KKKK...',
      '................',
    ],
  },
  // Knights' Guild: plumed steel helmet, big mustache, crested tabard, pauldrons.
  captain: {
    palette: {
      I: '#c9d2df',
      E: '#8d97a8',
      R: '#e0413b',
      r: '#a82c28',
      F: '#f1c27d',
      X: '#5a3a22',
      B: '#2e5fa8',
      C: '#24497f',
      G: '#e9b44c',
    },
    rows: [
      '.......KK.......',
      '......KRrK......',
      '......KRrK......',
      '....KKIIIIKK....',
      '...KIIIIIIIIK...',
      '...KEEEEEEEEK...',
      '...KEFKFFKFEK...',
      '...KEFFFFFFEK...',
      '...KEXXXXXXEK...',
      '..KIIKFFFFKIIK..',
      '.KIEIKBGGBKIEIK.',
      '..KFKBBGGBBKFK..',
      '...KBBBBBBBBK...',
      '...KCCCKKCCCK...',
      '...KKKK..KKKK...',
      '................',
    ],
  },
  // Forges the blades: bald, bushy dark beard, leather apron, bare forearms.
  armorer: {
    palette: {
      F: '#a0663a',
      f: '#c99062',
      X: '#1c1210',
      B: '#b03a2e',
      A: '#8a6440',
      a: '#6b4a2b',
      C: '#3a2e2a',
    },
    rows: [
      '................',
      '.....KKKKKK.....',
      '....KFFFffFK....',
      '...KFFFFFfFFK...',
      '...KFFKFFKFFK...',
      '...KFFFFFFFFK...',
      '...KXFFFFFFXK...',
      '...KXXFKKFXXK...',
      '..KBKXXXXXXKBK..',
      '.KBBBKXXXXKBBBK.',
      '.KFBKAAXXAAKBFK.',
      '.KFKAAAAAAAAKFK.',
      '..KAAaAAAAaAAK..',
      '...KCCCKKCCCK...',
      '...KKKK..KKKK...',
      '................',
    ],
  },
  // Keeper of the Royal Ledger: bun with a quill, half-moon glasses, an open book.
  librarian: {
    palette: {
      A: '#2d2438',
      F: '#f1c27d',
      Q: '#f4f4f8',
      G: '#e9b44c',
      B: '#1f8a8a',
      C: '#166666',
      P: '#f4ead2',
      R: '#8b2e3a',
      S: '#4a3b6b',
    },
    rows: [
      '.........KQ.....',
      '......KKKQK.....',
      '.....KAAAAK.....',
      '....KKAAAAKK....',
      '...KAAAAAAAAK...',
      '...KAGKGGKGAK...',
      '...KAFFFFFFAK...',
      '....KFFKKFFK....',
      '...KBBKFFKBBK...',
      '..KBBBRPPRBBBK..',
      '..KBBFRPPRFBBK..',
      '..KBBBRRRRBBBK..',
      '...KSSSSSSSSK...',
      '...KSSSSSSSSK...',
      '...KKKK..KKKK...',
      '................',
    ],
  },
}

// Frame order is load-bearing: see NPC_FRAME in app/src/game/world.ts.
const npcs = Object.entries(NPCS).map(([name, npc]) => ({ name, ...npc }))

// A cell is a grid (array of 16 strings), { rows, palette } for recolored grids, a raw
// 16x16 RGBA Buffer (tiles), or null.
function pixel(cell, x, y) {
  if (!cell) return null

  if (Buffer.isBuffer(cell)) {
    const o = (y * 16 + x) * 4

    return cell[o + 3] ? [cell[o], cell[o + 1], cell[o + 2]] : null
  }

  const rows = Array.isArray(cell) ? cell : cell.rows
  const palette = Array.isArray(cell) ? PALETTE : { ...PALETTE, ...cell.palette }
  const key = rows[y][x]

  if (!(key in palette)) throw new Error(`unknown palette key "${key}"`)

  return palette[key] ? hex(palette[key]) : null
}

function sheet(file, cells, { scale = 1, checker = false } = {}) {
  const cols = Math.max(...cells.map((r) => r.length))
  const w = cols * 16 * scale
  const h = cells.length * 16 * scale
  const buf = Buffer.alloc(w * h * 4)

  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const cell = cells[Math.floor(py / scale / 16)][Math.floor(px / scale / 16)]
      const rgb = pixel(cell, Math.floor(px / scale) % 16, Math.floor(py / scale) % 16)
      const o = (py * w + px) * 4

      if (rgb) buf.set([...rgb, 255], o)
      else if (checker) {
        const g = (Math.floor(px / 8) + Math.floor(py / 8)) % 2 ? 0x3a : 0x30
        buf.set([g, g + 4, g + 12, 255], o)
      }
    }

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, png(w, h, buf))
}

const grids = {
  ...dog,
  bot_slime: BOT_SLIME,
  phish: PHISH,
  sword_wood: [SWORD_WOOD],
  sword_steel: [SWORD_STEEL],
  shield_wood: [SHIELD_WOOD],
  ...Object.fromEntries(npcs.map((npc) => [npc.name, [npc.rows]])),
}

for (const [label, frames] of Object.entries(grids))
  frames.forEach((f, i) => {
    if (f.length !== 16 || f.some((r) => r.length !== 16)) throw new Error(`${label}[${i}] is not 16x16`)
  })

const assets = new URL('../app/public/assets/', import.meta.url).pathname
const out = new URL('./out/', import.meta.url).pathname
const dogCells = [dog.down, dog.up, dog.right, dog.left]

// Game sheets. Frame order is load-bearing: see app/src/game/sprites.ts.
sheet(join(assets, 'dog.png'), [dogCells.flat()])

sheet(join(assets, 'items.png'), [[SWORD_WOOD, SWORD_STEEL, SHIELD_WOOD, ...BOT_SLIME, ...PHISH]])

sheet(join(assets, 'npcs.png'), [npcs])

sheet(join(assets, 'tiles.png'), [tiles])

// Review sheet at 10x.
sheet(
  join(out, 'preview.png'),
  [
    ...dogCells.map((r) => [...r, null, null]),
    [SWORD_WOOD, SWORD_STEEL, SHIELD_WOOD, ...BOT_SLIME, ...PHISH],
    npcs.slice(0, 5),
    [npcs[5], ...tiles.slice(0, 4)],
  ],
  { scale: 10, checker: true },
)

sheet(join(out, 'tiles-preview.png'), [tiles.slice(0, 9), tiles.slice(9)], { scale: 8 })

// The game loads each sheet at a URL carrying a hash of its contents, so browsers never mix new
// map data with a stale cached sheet (missing tiles draw black).
const version = (name) =>
  createHash('sha256')
    .update(readFileSync(join(assets, `${name}.png`)))
    .digest('hex')
    .slice(0, 10)

const sheetUrls = ['dog', 'items', 'npcs', 'tiles'].map(
  (name) => `  ${name}: '/assets/${name}.png?v=${version(name)}',`,
)

writeFileSync(
  new URL('../app/src/game/sheets.ts', import.meta.url),
  `// Generated by art/sprites.mjs; don't edit. Each URL carries a hash of the sheet's contents.
export const SHEETS = {
${sheetUrls.join('\n')}
} as const
`,
)

console.log(`wrote ${assets}{dog,items,npcs,tiles}.png, app/src/game/sheets.ts and art/out previews`)
