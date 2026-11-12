// Redraws the README's statecharts from the XState machines: node scripts/statecharts.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { withCharts } from '../app/src/game/statecharts.ts'

const README = new URL('../README.md', import.meta.url)

writeFileSync(README, withCharts(readFileSync(README, 'utf8')))
