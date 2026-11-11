import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { DAWN_MS, MIN_NIGHT_MS, startNightActor, type Sleeper } from './night-machine.ts'
import type { Identity } from './ppl.ts'

const session: Identity = { authenticated: true, email: 'nick@example.com', groups: [] }

function setup() {
  const log: string[] = []

  const night = startNightActor({
    nightFalls: () => log.push('dark'),
    dayBreaks: () => log.push('day'),
    sleeps: () => log.push('sleeps'),
    wakes: () => log.push('wakes'),
    dawnSound: () => log.push('dawn'),
    signsIn: () => log.push('signsIn'),
    missedMorning: () => log.push('missed'),
    deliversLetter: ({ early }) => log.push(early ? 'letter:early' : 'letter'),
  })

  const sleeper: Sleeper = { lieDown: vi.fn(), wakeUp: vi.fn() }

  return { night, log, sleeper }
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => vi.useRealTimers())

describe('the night machine', () => {
  it('stays dark until the claims have arrived and the shortest night has passed', async () => {
    const { night, log } = setup()
    const id = night.fall(['g'], DAWN_MS)
    night.stale(id)
    night.claims(id, session)

    expect(night.dark()).toBe(true)
    await vi.advanceTimersByTimeAsync(MIN_NIGHT_MS)

    expect(night.day()).toBe(true)
    expect(log).toEqual(['dark', 'day', 'dawn', 'signsIn'])
  })

  it('wakes a sleeper when morning comes', async () => {
    const { night, log, sleeper } = setup()
    const id = night.fall([], 0)
    night.stale(id)
    night.bed(sleeper)
    night.claims(id, session)
    await vi.advanceTimersByTimeAsync(MIN_NIGHT_MS)

    expect(log.filter((entry) => entry === 'sleeps' || entry === 'wakes')).toEqual(['sleeps', 'wakes'])
  })

  it('ends with no sign-in, and a note, when the claims never arrive', async () => {
    const { night, log } = setup()
    const id = night.fall([], 0)
    night.stale(id)
    night.claims(id, null)
    await vi.advanceTimersByTimeAsync(MIN_NIGHT_MS)

    expect(log).toEqual(['dark', 'day', 'missed'])
  })

  it('drops answers that belong to a night that was reset', async () => {
    const { night, log } = setup()
    const old = night.fall([], 0)
    night.reset()
    const next = night.fall([], 0)
    night.stale(next)
    night.claims(old, session)
    await vi.advanceTimersByTimeAsync(MIN_NIGHT_MS * 2)

    expect(night.dark()).toBe(true)
    expect(log).toEqual(['dark'])
  })

  it('wakes whoever is asleep when the game is reset', () => {
    const { night, log, sleeper } = setup()
    night.stale(night.fall([], 0))
    night.bed(sleeper)
    night.reset()

    expect(night.day()).toBe(true)
    expect(log).toContain('wakes')
  })

  it('takes no second night while one is under way', () => {
    const { night } = setup()
    const first = night.fall([], 0)
    night.fall([], 0)

    expect(night.current(first)).toBe(true)
  })

  it('skips the dark when the session is already fresh, and says so early', async () => {
    const { night, log } = setup()
    night.fresh(night.fall([], 0), session)
    await vi.advanceTimersByTimeAsync(0)

    expect(log).toEqual(['signsIn', 'letter:early'])
  })
})

describe('the morning letter', () => {
  it('waits for the dawn, then for the player’s attention to be free', async () => {
    const { night, log } = setup()
    const id = night.fall([], DAWN_MS)
    night.stale(id)
    night.attention(true)
    night.claims(id, session)
    await vi.advanceTimersByTimeAsync(MIN_NIGHT_MS + DAWN_MS)

    expect(log).not.toContain('letter')
    night.attention(false)

    expect(log).toContain('letter')
  })
})
