// The favicon: Pomerium's arch mark (white arches on Pomerium purple, as on pomerium.com), drawn
// as pixel art like the rest of the game. Written as an SVG so it stays crisp at any size.

const PURPLE = '#5b14d7'
const WHITE = '#ffffff'

// P purple, W white, '.' transparent (the rounded corners).
const MARK = [
  '.PPPPPPPPPPPPPP.',
  'PPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPPP',
  'PPPPPPPPPPWWWWPP',
  'PPPPPPWWWWWWWWPP',
  'PPWWWWWWWWWWWWPP',
  'PPWWWWWWWWWWWWPP',
  'PPWWWPWWWWWPWWPP',
  'PPWWPPPWWPPPWWPP',
  'PPWWPPPWWPPPWWPP',
  'PPWWPPPWWPPPWWPP',
  'PPWWPPPWWPPPWWPP',
  'PPPPPPPPPPPPPPPP',
  'PPPPPPPPPPPPPPPP',
  '.PPPPPPPPPPPPPP.',
]

const COLORS = { P: PURPLE, W: WHITE }

/** One rect per run of same-colored pixels in a row, so the SVG stays small. */
export function faviconSvg() {
  const rects = MARK.flatMap((row, y) => {
    if (row.length !== 16) throw new Error(`favicon row ${y} is ${row.length} wide`)

    return [...row.matchAll(/P+|W+/g)].map(
      (run) =>
        `<rect x="${run.index}" y="${y}" width="${run[0].length}" height="1" fill="${COLORS[run[0][0]]}"/>`,
    )
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>\n`
}
