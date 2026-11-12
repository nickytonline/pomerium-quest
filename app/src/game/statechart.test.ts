import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { withCharts } from './statecharts.ts'

describe("the README's statecharts", () => {
  it('match the machines; run node scripts/statecharts.ts to redraw them', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')

    expect(withCharts(readme)).toBe(readme)
  })
})
