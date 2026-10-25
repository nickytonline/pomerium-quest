// Map tiles painted with rectangles onto 16x16 rasters. Order matters: the index of each
// tile here is its tile id in app/src/game/world.ts (TILE).

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

function raster() {
  const buf = Buffer.alloc(16 * 16 * 4)

  const rect = (x, y, w, h, color) => {
    const [r, g, b] = hex(color)

    for (let py = Math.max(0, y); py < Math.min(16, y + h); py++)
      for (let px = Math.max(0, x); px < Math.min(16, x + w); px++)
        buf.set([r, g, b, 255], (py * 16 + px) * 4)
  }

  return { buf, rect }
}

const grass = (rect) => {
  rect(0, 0, 16, 16, '#3b7d46')
  rect(3, 4, 1, 2, '#56a061')
  rect(4, 5, 1, 1, '#56a061')
  rect(11, 10, 1, 2, '#56a061')
  rect(12, 11, 1, 1, '#56a061')
  rect(8, 13, 1, 1, '#2f6838')
}

// Paving in the dirt road's sand color, so roads read as one system and gray walls and rocks stand out.
const cobble = (rect) => {
  rect(0, 0, 16, 16, '#9a7a4a')

  for (const [x, y] of [
    [1, 1],
    [9, 1],
    [5, 9],
    [13, 9],
  ]) {
    rect(x, y, 6, 6, '#c7a46b')
    rect(x, y, 6, 1, '#d6b77f')
  }

  rect(0, 9, 4, 6, '#c7a46b')
}

const floor = (rect) => {
  rect(0, 0, 16, 16, '#8b5d37')

  for (const y of [3, 7, 11, 15]) rect(0, y, 16, 1, '#714a2b')
  rect(6, 0, 1, 3, '#714a2b')
  rect(12, 4, 1, 3, '#714a2b')
  rect(3, 8, 1, 3, '#714a2b')
  rect(9, 12, 1, 3, '#714a2b')
}

const path = (rect) => {
  rect(0, 0, 16, 16, '#c7a46b')
  rect(3, 2, 2, 1, '#b08e58')
  rect(10, 6, 1, 1, '#b08e58')
  rect(6, 11, 2, 1, '#d6b77f')
  rect(13, 13, 1, 1, '#b08e58')
}

/**
 * Paints a 32x32 picture and splits it into four tiles (top-left, top-right, bottom-left,
 * bottom-right), each over cobble.
 */
const quad = (paint) => {
  const pixels = Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => null))

  const rect = (x, y, w, h, color) => {
    for (let py = Math.max(0, y); py < Math.min(32, y + h); py++)
      for (let px = Math.max(0, x); px < Math.min(32, x + w); px++) pixels[py][px] = color
  }

  paint(rect)

  return [
    [0, 0],
    [16, 0],
    [0, 16],
    [16, 16],
  ].map(([ox, oy]) => (tile) => {
    cobble(tile)

    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const color = pixels[oy + y][ox + x]

        if (color) tile(x, y, 1, 1, color)
      }
  })
}

/** Rows of [y, x0, x1], filled in one color: how the round shapes below are drawn. */
const rows = (rect, spans, color) => {
  for (const [y, x0, x1] of spans) rect(x0, y, x1 - x0 + 1, 1, color)
}

const range = (y0, y1, x0, x1) => Array.from({ length: y1 - y0 + 1 }, (_, i) => [y0 + i, x0, x1])

// A round stone basin seen from the front, a pillar and bowl, and water spilling from the bowl.
// Each frame moves the highlights one step down the streams, so the water reads as flowing.
const paintFountain = (rect, frame) => {
  const outline = '#241a2e'
  const stone = '#c3c6d3'
  const face = '#8d90a2'
  const mortar = '#6c6f80'
  const water = '#3d7fcf'
  const ripple = '#7fb6ef'
  const stream = '#9fcaf5'
  const glint = '#eef7ff'

  // Basin: outline, front wall, then the rim and the water on top.
  rows(
    rect,
    [
      [9, 8, 23],
      [10, 5, 26],
      [11, 3, 28],
      ...range(12, 25, 1, 30),
      [26, 2, 29],
      [27, 3, 28],
      [28, 5, 26],
      [29, 8, 23],
    ],
    outline,
  )
  rows(rect, [...range(16, 25, 2, 29), [26, 3, 28], [27, 5, 26], [28, 8, 23]], face)
  rect(2, 22, 28, 1, mortar)

  for (const x of [8, 16, 24]) rect(x, 19, 1, 3, mortar)

  for (const x of [4, 12, 20, 28]) rect(x, 23, 1, 3, mortar)
  rows(
    rect,
    [[10, 8, 23], [11, 5, 26], [12, 3, 28], ...range(13, 15, 2, 29), [16, 3, 28], [17, 5, 26], [18, 8, 23]],
    stone,
  )
  rows(rect, [[19, 5, 26]], mortar)
  rows(
    rect,
    [
      [12, 8, 23],
      [13, 5, 26],
      [14, 5, 26],
      [15, 6, 25],
      [16, 8, 23],
    ],
    water,
  )

  // Ripples spread out from where the streams land and from the pillar's foot.
  const spread = frame + 1
  rect(8 - spread, 14, 2 + spread, 1, ripple)
  rect(22, 14, 2 + spread, 1, ripple)
  rect(12 - frame, 16, 8 + frame * 2, 1, ripple)

  // Pillar and bowl.
  rect(13, 5, 6, 11, outline)
  rect(14, 6, 4, 9, stone)
  rect(17, 6, 1, 9, face)
  rect(10, 3, 12, 4, outline)
  rect(11, 4, 10, 2, stone)
  rect(12, 4, 8, 1, water)

  // Two streams spill over the bowl's lip and curve down into the basin, two pixels wide.
  // A glint every third step moves one step further down each frame.
  const path = [
    [10, 4],
    [9, 5],
    [8, 6],
    [8, 7],
    [7, 8],
    [7, 9],
    [7, 10],
    [7, 11],
    [7, 12],
  ]

  path.forEach(([x, y], i) => {
    const color = (i - frame) % 3 === 0 ? glint : stream
    rect(x, y, 2, 1, color)
    rect(30 - x, y, 2, 1, color)
  })

  // Splashes where the streams land, a little higher on alternate frames.
  for (const x of [5, 10]) {
    rect(x, frame === 1 ? 12 : 13, 1, 1, glint)
    rect(31 - x, frame === 1 ? 12 : 13, 1, 1, glint)
  }

  // The jet bubbles up from the bowl: a short column and a crown that rises and falls.
  rect(15, 1, 2, 3, stream)
  rect(15, 2 - (frame % 2), 2, 1, glint)

  const crown = [
    [14, 0],
    [13, 1],
    [12, 2],
  ][frame]

  rect(crown[0], crown[1], 1, 1, glint)
  rect(31 - crown[0], crown[1], 1, 1, glint)
}

/** The fountain's animation frames, four tiles each. */
const fountain = [0, 1, 2].flatMap((frame) => quad((rect) => paintFountain(rect, frame)))

const wallBlocks = (rect) => {
  rect(0, 0, 16, 16, '#4a4c59')

  for (let row = 0; row < 4; row++) {
    const y = row * 4
    rect(0, y, 16, 3, '#6f7385')
    const off = row % 2 ? 4 : 0

    for (let x = off; x < 16; x += 8) rect(x, y, 1, 3, '#4a4c59')
  }

  rect(0, 0, 16, 1, '#858898')
}

// A rounded boulder: light from the top-left, a crack down the middle, a soft ground shadow.
const ROCK = [
  '................',
  '.....KKKKK......',
  '...KKLHHLLKKK...',
  '..KLHHLLMMMMDK..',
  '.KLHLLMMCMMMMDKK',
  '.KLLLMMMCMMMLMDK',
  'KLLMMMMCMMMMMDDK',
  'KLMMMMMMCCMMMDDK',
  'KMMLMMMMMMCMMDDK',
  'KMMMMMMMMMCMDDDK',
  'KMMMMMMMMMMMDDDK',
  '.KMMMMMDMMMDDDK.',
  '.KDMMMMMMDDDDDK.',
  '..KDDDDDDDDDDK..',
  '..SKKKKKKKKKKS..',
  '....SSSSSSSS....',
]

const ROCK_COLORS = {
  K: '#2d2e35', // outline
  H: '#c3c5cd', // highlight
  L: '#9a9ca6', // light
  M: '#7b7d86', // mid
  D: '#565862', // shadow side
  C: '#2d2e35', // crack
  S: '#55576a', // ground shadow
}

// The Armorer's forge: an anvil on a stump with a hammer resting on top, and a bench laid out with
// hammers and tongs. Only for reading; nothing here can be taken.
const ANVIL = [
  '................',
  '................',
  '.......KKKK.....',
  '......KDDDDK....',
  '..KKKKKKKKKKKK..',
  '.KHHHHHHHHHHHHK.',
  'KIIIIIIIIIIIIDK.',
  '.KKIIIIIIIIDDK..',
  '...KKIIIIIDKK...',
  '.....KIIIDK.....',
  '.....KIIIDK.....',
  '....KIIIIIDK....',
  '...KBBBBBBBBK...',
  '...KbBBBBBBbK...',
  '...KKKKKKKKKK...',
  '....SSSSSSSS....',
]

const ANVIL_COLORS = {
  K: '#241a2e', // outline
  H: '#b8bfcc', // worn face
  I: '#5b6070', // iron
  D: '#3a3d48', // iron shadow, hammer head
  B: '#7a5126', // stump
  b: '#5b3a22', // stump shadow
  S: '#4a2f18', // floor shadow
}

const WORKBENCH = [
  '................',
  '................',
  '................',
  '..KKKK......KK..',
  '..KIIK.....KIK..',
  '..KIIKKKKK.KIK..',
  '..KIIKDDDDKIIIK.',
  'KKKKKKKKKKKKKKKK',
  'KBBBBBBBBBBBBBBK',
  'KbbbbbbbbbbbbbbK',
  'KKKKKKKKKKKKKKKK',
  '.KbK........KbK.',
  '.KbK........KbK.',
  '.KbK........KbK.',
  '.KKK........KKK.',
  '..SS........SS..',
]

const WORKBENCH_COLORS = {
  K: '#241a2e', // outline
  I: '#9aa3b2', // steel tools
  D: '#7a5126', // hammer handle
  B: '#a87a45', // bench top
  b: '#6b4226', // bench front and legs
  S: '#4a2f18', // floor shadow
}

/** Paints a 16x16 grid of color keys; '.' leaves the pixel underneath. */
const pixels = (rect, rows, colors) => {
  rows.forEach((row, y) => {
    if (row.length !== 16) throw new Error(`row ${y} is ${row.length} wide`)
    ;[...row].forEach((key, x) => {
      if (key !== '.') rect(x, y, 1, 1, colors[key])
    })
  })
}

const painters = [
  // 0 grass
  grass,
  // 1 flowers
  (rect) => {
    grass(rect)
    rect(4, 3, 2, 2, '#f2d16b')
    rect(11, 7, 2, 2, '#e86f8a')
    rect(6, 11, 2, 2, '#f4f0ff')
  },
  // 2 path
  path,
  // 3 cobble
  cobble,
  // 4 tree
  (rect) => {
    grass(rect)
    rect(6, 10, 4, 6, '#5b3a22')
    rect(2, 2, 12, 9, '#1e5b31')
    rect(1, 4, 14, 5, '#1e5b31')
    rect(4, 1, 8, 1, '#1e5b31')
    rect(4, 3, 4, 2, '#2f7d43')
    rect(3, 5, 2, 2, '#2f7d43')
  },
  // 5 wall
  wallBlocks,
  // 6 water
  (rect) => {
    rect(0, 0, 16, 16, '#2b66a8')
    rect(2, 4, 5, 1, '#5d9be0')
    rect(9, 10, 5, 1, '#5d9be0')
    rect(11, 3, 3, 1, '#4a86c8')
  },
  // 7 floor
  floor,
  // 8 bookshelf
  (rect) => {
    floor(rect)
    rect(1, 0, 14, 16, '#4e2f1a')
    const spines = ['#c0392b', '#2e86c1', '#d4ac0d', '#27ae60', '#8e44ad', '#e67e22']
    spines.forEach((c, i) => {
      rect(2 + i * 2, 2, 2, 5, c)
      rect(2 + i * 2, 9, 2, 5, spines[(i + 2) % spines.length])
    })
    rect(1, 7, 14, 2, '#6b4226')
  },
  // 9 lectern with the Royal Ledger
  (rect) => {
    floor(rect)
    rect(6, 8, 4, 7, '#5b3a22')
    rect(2, 4, 12, 5, '#6b4226')
    rect(3, 3, 5, 4, '#f4ecd8')
    rect(8, 3, 5, 4, '#efe4c8')
    rect(13, 0, 1, 5, '#ffffff')
  },
  // 10 chest closed
  (rect) => {
    floor(rect)
    // A dark outline and shadow, like every other object, and red lacquer so it doesn't sink into the floor.
    rect(2, 14, 14, 1, '#4a2f18')
    rect(1, 4, 14, 11, '#241a2e')
    rect(2, 5, 12, 9, '#7a2a1c')
    rect(2, 5, 12, 4, '#a8432b')
    rect(2, 9, 12, 1, '#e3b341')
    rect(7, 8, 2, 3, '#e3b341')
  },
  // 11 chest open
  (rect) => {
    floor(rect)
    rect(2, 14, 14, 1, '#4a2f18')
    rect(1, 1, 14, 14, '#241a2e')
    rect(2, 2, 12, 4, '#a8432b')
    rect(2, 7, 12, 7, '#7a2a1c')
    rect(3, 7, 10, 2, '#2a1a0e')
    rect(2, 10, 12, 1, '#e3b341')
  },
  // 12 sign
  (rect) => {
    grass(rect)
    rect(7, 9, 2, 7, '#5b3a22')
    rect(2, 2, 12, 8, '#7a5126')
    rect(3, 3, 10, 6, '#a87a45')
    rect(4, 5, 8, 1, '#6b4a27')
    rect(4, 7, 6, 1, '#6b4a27')
  },
  // 13 cracked rock
  (rect) => {
    cobble(rect)
    pixels(rect, ROCK, ROCK_COLORS)
  },
  // 14 night market gate (no route yet)
  (rect) => {
    grass(rect)
    rect(1, 1, 14, 15, '#3a2414')

    for (const x of [4, 8, 12]) rect(x, 1, 1, 15, '#2a190d')
    rect(1, 5, 14, 1, '#2b2b33')
    rect(1, 11, 14, 1, '#2b2b33')
    rect(7, 7, 2, 3, '#e3b341')
  },
  // 15 gate closed
  (rect) => {
    path(rect)
    rect(0, 0, 3, 16, '#5d6070')
    rect(13, 0, 3, 16, '#5d6070')
    rect(0, 0, 16, 3, '#6f7385')

    for (let x = 4; x <= 12; x += 2) rect(x, 3, 1, 13, '#2b2b33')
    rect(3, 7, 10, 1, '#2b2b33')
    rect(3, 12, 10, 1, '#2b2b33')
    rect(6, 0, 4, 3, '#8b5cf6')
  },
  // 16 gate open
  (rect) => {
    path(rect)
    rect(0, 0, 3, 16, '#5d6070')
    rect(13, 0, 3, 16, '#5d6070')
    rect(0, 0, 16, 3, '#6f7385')

    for (let x = 4; x <= 12; x += 2) rect(x, 3, 1, 2, '#2b2b33')
    rect(6, 0, 4, 3, '#4ade80')
  },
  // 17–28 fountain: three frames of top-left, top-right, bottom-left, bottom-right
  ...fountain,
  // 29 anvil
  (rect) => {
    floor(rect)
    pixels(rect, ANVIL, ANVIL_COLORS)
  },
  // 30 workbench
  (rect) => {
    floor(rect)
    pixels(rect, WORKBENCH, WORKBENCH_COLORS)
  },
]

export const tiles = painters.map((paint) => {
  const { buf, rect } = raster()
  paint(rect)

  return buf
})
