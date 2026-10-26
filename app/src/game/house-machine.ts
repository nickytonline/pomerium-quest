// The player's house as a statechart (docs/prd/your-house.md). It runs beside chapter one's quest:
//
//   unowned → slimes → bread → guild → baker → window → done
//
// Each state after `unowned` is a letter on the desk. The house starts public, so the first letter
// is about the slimes that walked in. A letter is solved when real visits through Pomerium come out
// the way it asks.
import { assign, createActor, setup, type SnapshotFrom } from 'xstate'

export type HouseEvent =
  | { readonly type: 'DEED_GIVEN' }
  | { readonly type: 'LETTER_READ' }
  | { readonly type: 'LETTER_SOLVED' }

export interface HouseContext {
  /** The player has read the letter now on the desk. */
  readonly letterRead: boolean
}

export const houseMachine = setup({
  types: {
    // SAFETY: XState reads these only as type carriers; the values are never used at runtime.
    context: {} as HouseContext,
    // SAFETY: same type-carrier idiom as above.
    events: {} as HouseEvent,
  },
  actions: {
    // Solving a letter brings the next one, unread.
    nextLetter: assign({ letterRead: false }),
  },
}).createMachine({
  id: 'house',
  initial: 'unowned',
  context: { letterRead: false },
  on: { LETTER_READ: { actions: assign({ letterRead: true }) } },
  states: {
    unowned: {
      description: 'The house stands locked; the sage holds the deed.',
      on: { DEED_GIVEN: 'slimes' },
    },
    slimes: {
      description: 'Public: Pomerium lets in slimes with no session, and the traveler. Keep out the slimes.',
      on: { LETTER_SOLVED: { target: 'bread', actions: 'nextLetter' } },
    },
    bread: {
      description: 'The traveler ate the bread. Only the player may come in.',
      on: { LETTER_SOLVED: { target: 'guild', actions: 'nextLetter' } },
    },
    guild: {
      description: "Let in the player's friends from the Knights' Guild.",
      on: { LETTER_SOLVED: { target: 'baker', actions: 'nextLetter' } },
    },
    baker: {
      description: 'Any citizen may visit, except the baker: a deny rule.',
      on: { LETTER_SOLVED: { target: 'window', actions: 'nextLetter' } },
    },
    window: {
      description: 'Friends may look in through the window (GET), but not knock (POST).',
      on: { LETTER_SOLVED: { target: 'done', actions: 'nextLetter' } },
    },
    done: {
      description: 'Every letter answered. The house is the player’s to keep changing.',
    },
  },
})

export type HouseStage = SnapshotFrom<typeof houseMachine>['value']

/** The stages that have a letter on the desk. */
export type LetterStage = Exclude<HouseStage, 'unowned' | 'done'>

const STORAGE_KEY = 'pomerium-quest/house/v1'

function restore() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

    // SAFETY: written by persistHouse() below from actor.getPersistedSnapshot().
    return raw ? (JSON.parse(raw) as SnapshotFrom<typeof houseMachine>) : undefined
  } catch {
    return undefined
  }
}

function start(snapshot = restore()) {
  try {
    return createActor(houseMachine, snapshot ? { snapshot } : {}).start()
  } catch {
    // A snapshot from an older machine version: start over rather than crash.
    return createActor(houseMachine).start()
  }
}

export let houseActor = start()

export function persistHouse() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(houseActor.getPersistedSnapshot()))
  } catch {
    // Storage unavailable; the house lasts for this tab only.
  }
}

export function resetHouse() {
  houseActor.stop()

  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored.
  }

  houseActor = start(undefined)
}

export const houseStage = (): HouseStage => houseActor.getSnapshot().value
