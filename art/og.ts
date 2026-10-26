// The repository's social preview: the moment the steel sword rises out of the armory's chest,
// next to the game's name and the repo's description. Chrome draws it from the game's own sheets and fonts.
//
//   node art/og.ts   → docs/images/social-preview.png (upload it in the repo's settings)
//
// Set CHROME to Chrome's binary if it isn't in the usual macOS place.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TILE, buildWorld, same } from '../app/src/game/world.ts'

const WIDTH = 1280
const HEIGHT = 640
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const assets = new URL('../app/public/assets/', import.meta.url).pathname

const sheet = (name: string) =>
  `data:image/png;base64,${readFileSync(join(assets, `${name}.png`)).toString('base64')}`

// The armory from the real map, 8 tiles square: the room, its gate open, and the street outside.
const world = buildWorld()
const CROP = { x: 30, y: 1, size: 8 }
const gate = world.gates.find((candidate) => candidate.zoneId === 'armory')

const MAP = world.tiles.slice(CROP.y, CROP.y + CROP.size).map((row, y) =>
  row.slice(CROP.x, CROP.x + CROP.size).map((tile, x) => {
    const at = { x: x + CROP.x, y: y + CROP.y }

    if (same(world.chest, at)) return TILE.chestOpen

    return gate && same(gate, at) ? TILE.gateOpen : tile
  }),
)

// As in the game: the dog faces the open chest, the sword hovers 18px above it (raiseItem in
// scene.ts), and the guard has stepped aside from their post outside the gate.
const SPRITES = [
  { sheet: 'npcs', frame: 8, x: 34, y: 8 },
  { sheet: 'dog', frame: 3, x: world.chest.x, y: world.chest.y + 1 },
  { sheet: 'items', frame: 1, x: world.chest.x, y: world.chest.y - 18 / 16 },
].map((s) => ({ ...s, x: s.x - CROP.x, y: s.y - CROP.y }))

const html = `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;600&family=Pixelify+Sans:wght@700&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #15102a; color: #f3ecff;
    font-family: 'IBM Plex Sans', sans-serif; display: flex }
  canvas { width: 640px; height: 640px; image-rendering: pixelated; flex: none }
  .text { padding: 80px 80px 80px 56px; display: flex; flex-direction: column; justify-content: center; gap: 22px }
  h1 { font: 700 60px/1 'Pixelify Sans'; color: #ffd86b; text-shadow: 4px 4px 0 #0e0a1d; white-space: nowrap }
  p { font-size: 32px; line-height: 1.4; color: #f3ecff }
</style></head>
<body>
<canvas id="scene" width="128" height="128"></canvas>
<div class="text">
  <h1>Pomerium Quest</h1>
  <p>A top-down pixel-art action RPG that teaches how Pomerium works, running behind a real Pomerium instance.</p>
</div>
<script>
  const MAP = ${JSON.stringify(MAP)}
  const SPRITES = ${JSON.stringify(SPRITES)}
  const SHEETS = ${JSON.stringify(Object.fromEntries(['tiles', 'dog', 'items', 'npcs'].map((n) => [n, sheet(n)])))}
  const ctx = document.getElementById('scene').getContext('2d')
  const load = (src) => new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(img); img.src = src })
  const cell = (img, frame, x, y) =>
    ctx.drawImage(img, (frame % (img.width / 16)) * 16, Math.floor(frame / (img.width / 16)) * 16, 16, 16, Math.round(x * 16), Math.round(y * 16), 16, 16)

  Promise.all(Object.entries(SHEETS).map(async ([name, src]) => [name, await load(src)])).then((loaded) => {
    const img = Object.fromEntries(loaded)

    MAP.forEach((row, y) => row.forEach((tile, x) => cell(img.tiles, tile, x, y)))
    SPRITES.forEach((s) => cell(img[s.sheet], s.frame, s.x, s.y))
  })
</script>
</body></html>
`

const dir = mkdtempSync(join(tmpdir(), 'quest-og-'))
const page = join(dir, 'og.html')
const out = new URL('../docs/images/social-preview.png', import.meta.url).pathname

writeFileSync(page, html)

execFileSync(
  CHROME,
  [
    '--headless',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${WIDTH},${HEIGHT}`,
    '--virtual-time-budget=5000',
    `--screenshot=${out}`,
    `file://${page}`,
  ],
  { stdio: 'ignore' },
)

console.log(`wrote ${out}`)
