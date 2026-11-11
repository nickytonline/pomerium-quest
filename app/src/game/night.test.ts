import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { GROUPS } from './groups.ts'
import type { Identity } from './ppl.ts'

const signedIn: Identity = { authenticated: true, email: 'nick@example.com', groups: [] }
const withClaims: Identity = { ...signedIn, groups: [GROUPS.citizens], deed: '3f9a1c2b7d4e' }

/** The session the game is waiting on: the test decides when Pomerium has refreshed it. */
let morning: (next: Identity | null) => void

vi.mock('./access.ts', () => ({
  waitForClaims: () => new Promise((resolve) => (morning = resolve)),
  probe: vi.fn(),
  requestZone: vi.fn(),
  signInUrl: vi.fn(),
}))

vi.mock('./sound.ts', () => ({ sfx: vi.fn() }))

// The store imports React for its hook; nothing here renders, and reloading React's CommonJS build is noisy.
vi.mock('react', () => ({ useSyncExternalStore: vi.fn() }))

/** Loads the game's story fresh, so its night and sleep state doesn't leak between tests. */
async function load() {
  vi.resetModules()
  const store = await import('./store.ts')
  const story = await import('./story.ts')
  const sfx = (await import('./sound.ts')).sfx

  store.quest.resetProgress()
  store.quest.setIdentity(signedIn)
  store.quest.send({ type: 'SIGNED_IN', groups: [] })
  store.quest.send({ type: 'SAGE_SPOKE' })
  store.quest.send({ type: 'CITIZEN_GRANTED' })

  return { quest: store.quest, story, sfx }
}

const sleeper = () => ({ lieDown: vi.fn(), wakeUp: vi.fn() })

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('night', () => {
  it('falls once the Oracle has awarded claims the session lacks', async () => {
    const { quest, story } = await load()

    expect(story.claimsPending()).toBe(true)
    story.startNight()

    expect(quest.get().night).toBe(true)
  })

  it('does not fall when there is nothing pending', async () => {
    const { quest, story } = await load()
    quest.setIdentity(withClaims)

    story.startNight()

    expect(quest.get().night).toBe(false)
  })

  it("doesn't start a second night on top of the first", async () => {
    const { quest, story } = await load()
    story.startNight()
    quest.setNight(false)

    story.startNight()

    expect(quest.get().night).toBe(false)
  })

  it('ends with the claims in the session and the player signed in with them', async () => {
    const { quest, story } = await load()
    story.startNight()

    morning(withClaims)
    await vi.waitFor(() => expect(quest.get().night).toBe(false))

    expect(quest.get().identity).toEqual(withClaims)
  })

  it("ends with a toast, and no new claims, when the Oracle's letter never arrives", async () => {
    const { quest, story } = await load()
    story.startNight()

    morning(null)
    await vi.waitFor(() => expect(quest.get().night).toBe(false))

    expect(quest.get().toast?.text).toContain("letter didn't reach the guards")
    expect(quest.get().identity).toEqual(signedIn)
  })

  it('can fall again the next time a claim is awarded', async () => {
    const { quest, story } = await load()
    story.startNight()
    morning(null)
    await vi.waitFor(() => expect(quest.get().night).toBe(false))

    story.startNight()

    expect(quest.get().night).toBe(true)
  })
})

describe('night after the owl is trusted with a letter', () => {
  it('falls when the Oracle awards keyholders to a session that has falconers', async () => {
    const { quest, story } = await load()
    const falconer: Identity = { ...withClaims, groups: [GROUPS.citizens, GROUPS.falconers] }

    for (const type of [
      'KEEP_ENTERED',
      'OWL_SOUGHT',
      'OWL_CAUGHT',
      'OWL_TURNED_BACK',
      'FALCONER_VOUCHED',
    ] as const)
      quest.sendOwl({ type })

    quest.setIdentity(falconer)
    quest.sendOwl({ type: 'SIGNED_IN', groups: falconer.groups })
    quest.sendOwl({ type: 'LETTER_DELIVERED' })

    expect(quest.get().owlStage).toBe('entrusted')
    expect(story.claimsPending()).toBe(true)

    story.startNight()

    expect(quest.get().night).toBe(true)
  })
})

describe('sleeping through the night', () => {
  it('lays the player down and marks them asleep', async () => {
    const { quest, story, sfx } = await load()
    const bed = sleeper()

    story.goToBed(bed)

    expect(bed.lieDown).toHaveBeenCalledOnce()
    expect(quest.get().night).toBe(true)
    expect(quest.get().sleeping).toBe(true)
    expect(sfx).toHaveBeenCalledWith('sleep')
  })

  it('wakes them at morning, with the claims', async () => {
    const { quest, story, sfx } = await load()
    const bed = sleeper()
    story.goToBed(bed)

    morning(withClaims)
    await vi.waitFor(() => expect(bed.wakeUp).toHaveBeenCalledOnce())

    expect(quest.get().night).toBe(false)
    expect(quest.get().sleeping).toBe(false)
    expect(sfx).toHaveBeenCalledWith('wake')
  })

  it('wakes them even when the letter never arrives', async () => {
    const { quest, story, sfx } = await load()
    const bed = sleeper()
    story.goToBed(bed)

    morning(null)
    await vi.waitFor(() => expect(bed.wakeUp).toHaveBeenCalledOnce())

    expect(quest.get().sleeping).toBe(false)
    expect(sfx).not.toHaveBeenCalledWith('wake')
  })

  it('lets only one bed take the player at a time', async () => {
    const { story } = await load()
    const first = sleeper()
    const second = sleeper()

    story.goToBed(first)
    story.goToBed(second)

    expect(first.lieDown).toHaveBeenCalledOnce()
    expect(second.lieDown).not.toHaveBeenCalled()
  })

  it("won't put the player to bed when the Oracle has no news", async () => {
    const { quest, story } = await load()
    quest.setIdentity(withClaims)
    const bed = sleeper()

    story.goToBed(bed)

    expect(bed.lieDown).not.toHaveBeenCalled()
    expect(quest.get().night).toBe(false)
    expect(quest.get().sleeping).toBe(false)
    expect(quest.get().dialog).not.toBeNull()
  })
})

describe('walking around at night', () => {
  it('leaves the player awake while night is on', async () => {
    const { quest, story } = await load()

    story.startNight()

    expect(quest.get().night).toBe(true)
    expect(quest.get().sleeping).toBe(false)
  })

  it('lets them lie down partway through the night', async () => {
    const { quest, story } = await load()
    const bed = sleeper()
    story.startNight()

    story.goToBed(bed)

    expect(bed.lieDown).toHaveBeenCalledOnce()
    expect(quest.get().sleeping).toBe(true)
  })

  it('morning needs no bed: the night ends for a player on their feet', async () => {
    const { quest, story } = await load()
    story.startNight()

    morning(withClaims)
    await vi.waitFor(() => expect(quest.get().night).toBe(false))

    expect(quest.get().sleeping).toBe(false)
  })
})

describe('the store at night', () => {
  it('clears sleeping when night ends', async () => {
    const { quest } = await load()
    quest.setNight(true)
    quest.setSleeping(true)

    quest.setNight(false)

    expect(quest.get().sleeping).toBe(false)
  })

  it('keeps sleeping while night goes on', async () => {
    const { quest } = await load()
    quest.setNight(true)
    quest.setSleeping(true)

    quest.setNight(true)

    expect(quest.get().sleeping).toBe(true)
  })
})
