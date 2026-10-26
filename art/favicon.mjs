// The favicon: the Pomeranian's head as it looks walking down, cropped from the game sprite so the
// two never drift. Written as an SVG so it stays crisp at any size.

// The sprite's head ends where the jacket begins, so close the chin under the tongue.
const CHIN = ['....KKLMMLKK....', '......KMMK......', '.......KK.......']

/** One rect per run of same-colored pixels in a row, so the SVG stays small. */
export function faviconSvg(headDown, palette) {
  const rows = ['................', '................', ...headDown.slice(0, 10), ...CHIN, '................']

  if (rows.length !== 16) throw new Error(`favicon is ${rows.length} tall`)

  const rects = rows.flatMap((row, y) => {
    if (row.length !== 16) throw new Error(`favicon row ${y} is ${row.length} wide`)

    return [...row.matchAll(/([^.])\1*/g)].map(
      (run) =>
        `<rect x="${run.index}" y="${y}" width="${run[0].length}" height="1" fill="${palette[run[0][0]]}"/>`,
    )
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>\n`
}
