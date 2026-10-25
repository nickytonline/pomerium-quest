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
  // 17 fountain
  (rect) => {
    cobble(rect)
    rect(0, 3, 16, 11, '#a7a9b6')
    rect(2, 5, 12, 7, '#3d7fcf')
    rect(7, 2, 2, 5, '#cfe6ff')
  },
]

export const tiles = painters.map((paint) => {
  const { buf, rect } = raster()
  paint(rect)

  return buf
})
