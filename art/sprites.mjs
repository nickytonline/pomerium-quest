// Pixel-art source for Pomerium Quest. Each sprite is a 16x16 grid of palette keys.
// Run: node art/sprites.mjs  → writes app/public/assets/*.png and art/out/ previews
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tiles } from './tiles.mjs'
import { deflateSync } from 'node:zlib'

const PALETTE = {
  '.': null,
  K: '#241a2e', // outline
  O: '#ef8f55', // fur
  L: '#fbd3a6', // cream fur
  S: '#c8643c', // fur shadow
  G: '#e9b44c', // gold (glasses frame, studs)
  C: '#3fe3f2', // lens cyan
  M: '#ff4fb8', // lens magenta
  W: '#ffffff', // glint
  N: '#3a2630', // nose
  J: '#2a2950', // jacket
  H: '#4b55a0', // jacket highlight
  B: '#b5813e', // wood
  D: '#7a5126', // dark wood
  I: '#dfe7f1', // steel
  E: '#8d97a8', // steel shadow
  Q: '#4fbf8f', // slime
  R: '#a6f0cf', // slime highlight
  Z: '#0e2a1f', // slime eyes
}

const HEAD_DOWN = [
  '..K..........K..',
  '.KOK........KOK.',
  '.KLOK......KOLK.',
  '.KOOOKKKKKKOOOK.',
  'KOOOOOOOOOOOOOOK',
  'KOGGGGGGGGGGGGOK',
  'KOKCWCCKKCCWCKOK',
  'KOKMMMMKKMMMMKOK',
  'KOOKMMKLLKMMKOOK',
  '.KLLKKLNNLKKLLK.',
  '..KLLLKLLKLLLK..',
  '.KJJKLLLLLLKJJK.',
  'KJHJJKLLLLKJJHJK',
  'KJHGJJKLLKJJGHJK',
  '.KJJJJJHHJJJJJK.',
]
const HEAD_UP = [
  '..K..........K..',
  '.KOK........KOK.',
  '.KOOK......KOOK.',
  '.KOOOKKKKKKOOOK.',
  'KOOOOOOOOOOOOOOK',
  'KOOOOOOOOOOOOOOK',
  'KOOSOOOOOOOOSOOK',
  'KOOOOSOOOOSOOOOK',
  'KSOOOOOOOOOOOOSK',
  '.KSOOOOOOOOOOSK.',
  '..KSSOOOOOOSSK..',
  '.KHHJJJJJJJJHHK.',
  'KJJJJJJJJJJJJJJK',
  'KJHJJJJJJJJJJHJK',
  '.KJJJJJJJJJJJJK.',
]
const HEAD_RIGHT = [
  '....K....K......',
  '...KOK..KOK.....',
  '..KOOOKKOOOK....',
  '.KOOOOOOOOOOK...',
  'KOOOOOOOOOOOOK..',
  'KOOOOOGGGGGGGK..',
  'KSOOOOKCWCCCKOK.',
  'KSOOOOKMMMMMKLLK',
  'KSSOOOOKMMMKLLNK',
  '.KSOOOLLLLLLLKK.',
  '..KSOLLLLLLK....',
  '..KJJJLLLLJK....',
  '.KJJJHJLLJJK....',
  '.KJJGHJJJJJK....',
  '.KJJJJJJJJJK....',
]

const FRONT_FEET = { idle: '.KOOK......KOOK.', a: '.KOOK......KK...', b: '...KK......KOOK.' }
const SIDE_FEET = { idle: '..KOK...KOK.....', a: '...KOK.KOK......', b: '.KOK.....KOK....' }

const withFeet = (body, feet) => [...body, feet]
const mirror = rows => rows.map(r => [...r].reverse().join(''))

const dog = {
  down: ['idle', 'a', 'b'].map(f => withFeet(HEAD_DOWN, FRONT_FEET[f])),
  up: ['idle', 'a', 'b'].map(f => withFeet(HEAD_UP, FRONT_FEET[f])),
  right: ['idle', 'a', 'b'].map(f => withFeet(HEAD_RIGHT, SIDE_FEET[f])),
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
const SWORD_STEEL = SWORD_WOOD.map((r, i) => (i < 10 ? r.replace(/B/g, 'I').replace(/D/g, 'E') : r.replace(/D/g, 'G')))
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
const SLIME = [
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '......KKKK......',
    '....KKQQQQKK....',
    '...KQRRQQQQQK...',
    '..KQRRQQQQQQQK..',
    '..KQQQZQQZQQQK..',
    '.KQQQQZQQZQQQQK.',
    '.KQQQQQQQQQQQQK.',
    '.KQQQQQQQQQQQQK.',
    '..KKQQQQQQQQKK..',
    '....KKKKKKKK....',
    '................',
  ],
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....KKKKKK.....',
    '...KKQRRQQQKK...',
    '..KQRRQQQQQQQK..',
    '.KQQQQZQQZQQQQK.',
    'KQQQQQZQQZQQQQQK',
    'KQQQQQQQQQQQQQQK',
    '.KKQQQQQQQQQQKK.',
    '...KKKKKKKKKK...',
    '................',
  ],
]

// ---- tiny PNG encoder ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = buf => {
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
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

// NPCs share one body template; each gets its own colors for hair/hood (A),
// skin (F), robe (B), robe shade (C) and beard or mouth (X).
const PERSON = [
  '................',
  '.....KKKKKK.....',
  '....KAAAAAAK....',
  '....KAFFFFAK....',
  '....KFKFFKFK....',
  '....KFFFFFFK....',
  '.....KFXXFK.....',
  '....KBBBBBBK....',
  '...KBBCBBCBBK...',
  '...KBBBBBBBBK...',
  '...KFBBBBBBFK...',
  '...KBBBBBBBBK...',
  '....KBBBBBBK....',
  '....KCCKKCCK....',
  '....KKK..KKK....',
  '................',
]
const NPC_COLORS = {
  sage: { A: '#e8e8ee', F: '#f1c27d', B: '#7d8091', C: '#5f6272', X: '#e8e8ee' },
  oracle: { A: '#6d3fc4', F: '#f6d3b3', B: '#8b5cf6', C: '#6d3fc4', X: '#f6d3b3' },
  traveler: { A: '#7a5126', F: '#d9a066', B: '#8a6a45', C: '#6b5034', X: '#d9a066' },
  captain: { A: '#c9d2df', F: '#f1c27d', B: '#2e5fa8', C: '#24497f', X: '#f1c27d' },
  armorer: { A: '#4a2c17', F: '#e0ac69', B: '#b03a2e', C: '#85291f', X: '#4a2c17' },
  librarian: { A: '#2d2438', F: '#f1c27d', B: '#1f8a8a', C: '#166666', X: '#f1c27d' },
}
const npcs = Object.entries(NPC_COLORS).map(([name, colors]) => ({ name, rows: PERSON, palette: colors }))


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
  const cols = Math.max(...cells.map(r => r.length))
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

const grids = { ...dog, slime: SLIME, sword_wood: [SWORD_WOOD], sword_steel: [SWORD_STEEL], shield_wood: [SHIELD_WOOD], person: [PERSON] }
for (const [label, frames] of Object.entries(grids))
  frames.forEach((f, i) => {
    if (f.length !== 16 || f.some(r => r.length !== 16)) throw new Error(`${label}[${i}] is not 16x16`)
  })

const assets = new URL('../app/public/assets/', import.meta.url).pathname
const out = new URL('./out/', import.meta.url).pathname
const dogCells = [dog.down, dog.up, dog.right, dog.left]

// Game sheets. Frame order is load-bearing: see app/src/game/sprites.ts.
sheet(join(assets, 'dog.png'), [dogCells.flat()])
sheet(join(assets, 'items.png'), [[SWORD_WOOD, SWORD_STEEL, SHIELD_WOOD, ...SLIME]])
sheet(join(assets, 'npcs.png'), [npcs])
sheet(join(assets, 'tiles.png'), [tiles])

// Review sheet at 10x.
sheet(
  join(out, 'preview.png'),
  [...dogCells.map(r => [...r, null, null]), [SWORD_WOOD, SWORD_STEEL, SHIELD_WOOD, SLIME[0], SLIME[1]], npcs.slice(0, 5), [npcs[5], ...tiles.slice(0, 4)]],
  { scale: 10, checker: true },
)
sheet(join(out, 'tiles-preview.png'), [tiles.slice(0, 9), tiles.slice(9)], { scale: 8 })
console.log(`wrote ${assets}{dog,items,npcs,tiles}.png and art/out previews`)
