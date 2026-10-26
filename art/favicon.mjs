// The favicon: the Pomeranian's head, facing down, on a light tile. Drawn on its own rather than
// cropped from the dog sprite, which reads as a masked cat at tab size; the mane and chest ruff
// are what make it a Pomeranian. Written as an SVG so it stays crisp at any size.

const BACKGROUND = '#dddddd'

// Keys are the sprite palette's (see PALETTE in sprites.mjs); '.' shows the background.
const HEAD = [
  '...KK......KK...',
  '..KOSK....KSOK..',
  '.KKOOSKKKKSOOKK.',
  'KUOOOOUUUUOOOOUK',
  'KOOQQQQQQQQQQOOK',
  'KOQQQWQOOQWQQQOK',
  'KUOKQQKLLKQQKOUK',
  'KOSOLLNNNNLLOSOK',
  '.KOSLLLNNLLLSOK.',
  'KUOOSLKMMKLSOOUK',
  '.KUOOKLMMLKOOUK.',
  'KUUOOOKMMKOOOUUK',
  '.KUUUOOKKOOUUUK.',
  '..KKUUUUUUUUKK..',
  '....KKKKKKKK....',
  '................',
]

/** One rect per run of same-colored pixels in a row, so the SVG stays small. */
export function faviconSvg(palette) {
  const rects = HEAD.flatMap((row, y) => {
    if (row.length !== 16) throw new Error(`favicon row ${y} is ${row.length} wide`)

    return [...row.matchAll(/([^.])\1*/g)].map(
      (run) =>
        `<rect x="${run.index}" y="${y}" width="${run[0].length}" height="1" fill="${palette[run[0][0]]}"/>`,
    )
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" rx="2" fill="${BACKGROUND}"/>${rects.join('')}</svg>\n`
}
