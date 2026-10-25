// Pixel-art source for Pomerium Quest. Each sprite is a 16x16 grid of palette keys.
// Run: node art/sprites.mjs  → writes art/out/*.png (1x sheets + 8x previews)
import { writeFileSync } from 'node:fs'
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

// Lay sprites out on a grid; `cells` is rows of 16x16 sprites (null = empty cell).
function sheet(name, cells, { scale = 1, checker = false } = {}) {
  const cols = Math.max(...cells.map(r => r.length))
  const w = cols * 16 * scale
  const h = cells.length * 16 * scale
  const buf = Buffer.alloc(w * h * 4)
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const sprite = cells[Math.floor(py / scale / 16)][Math.floor(px / scale / 16)]
      const sx = Math.floor(px / scale) % 16
      const sy = Math.floor(py / scale) % 16
      const key = sprite?.[sy]?.[sx] ?? '.'
      if (!(key in PALETTE)) throw new Error(`${name}: unknown key "${key}"`)
      const color = PALETTE[key]
      const o = (py * w + px) * 4
      if (color) buf.set([...hex(color), 255], o)
      else if (checker) {
        const g = (Math.floor(px / 8) + Math.floor(py / 8)) % 2 ? 0x3a : 0x30
        buf.set([g, g + 4, g + 12, 255], o)
      }
    }
  writeFileSync(new URL(`./out/${name}.png`, import.meta.url), png(w, h, buf))
}

for (const [label, frames] of Object.entries({ ...dog, slime: SLIME, sword_wood: [SWORD_WOOD], sword_steel: [SWORD_STEEL], shield_wood: [SHIELD_WOOD] }))
  frames.forEach((f, i) => {
    if (f.length !== 16 || f.some(r => r.length !== 16)) throw new Error(`${label}[${i}] is not 16x16`)
  })

const dogCells = [dog.down, dog.up, dog.right, dog.left]
sheet('dog', dogCells)
sheet('items', [[SWORD_WOOD, SWORD_STEEL, SHIELD_WOOD, ...SLIME]])
sheet('preview', [...dogCells.map(r => [...r, null]), [SWORD_WOOD, SWORD_STEEL, SHIELD_WOOD, SLIME[0]]], { scale: 10, checker: true })
console.log('wrote art/out/dog.png, items.png, preview.png')
