// The night the Oracle's claims take to reach the session, as a statechart. Two regions run side by side:
//
//   night:  day → dusk → dark | day         dark: awake ⇄ asleep
//   letter: none → dawning → waiting → none
//
// Night falls when the Oracle awards a claim. At dusk the game checks whether Pomerium has already refreshed
// the session: if so it is day again at once, with the news. Otherwise it is dark until the new claims have
// arrived and the shortest night has passed, and then morning comes. The morning letter is a second region,
// so it can wait for the player's attention to be free instead of landing on top of a dialog or an errand.
//
// The machine holds no effects. The story provides them (see `startNightActor`), and events from a night
// that was reset or replaced carry its id, so they are dropped.
import { assign, createActor, raise, setup } from 'xstate'

import type { Identity } from './ppl.ts'

/** The shortest a night lasts, so the townsfolk can be seen going to bed even when the session was already fresh. */
export const MIN_NIGHT_MS = 8000

/** How long day takes to fade back in; the morning letter waits for it. */
export const DAWN_MS = 2500

/** The player's end of a night's sleep: the scene lays the dog down in the bed and gets them up again. */
export interface Sleeper {
  readonly lieDown: () => void
  readonly wakeUp: () => void
}

/** The Oracle's news for the morning: what the player now is, and whether Pomerium refreshed on its own. */
export interface Morning {
  readonly next: Identity
  readonly awarded: readonly string[]
  readonly early: boolean
  readonly dawnMs: number
}

export interface NightContext {
  /** Which night this is. Events carry it, so a night left behind can't end the one that replaced it. */
  readonly id: number
  readonly awarded: readonly string[]
  readonly dawnMs: number
  readonly minPassed: boolean
  readonly settled: boolean
  /** The session once it carries the claims, or null if it never did. */
  readonly next: Identity | null
  readonly sleeper: Sleeper | null
  /** Something has the player's attention (a dialog, a refusal, an errand), so a letter has to wait. */
  readonly busy: boolean
  readonly morning: Morning | null
}

export type NightEvent =
  | { readonly type: 'FALL'; readonly awarded: readonly string[]; readonly dawnMs: number }
  | { readonly type: 'FRESH'; readonly id: number; readonly next: Identity }
  | { readonly type: 'STALE'; readonly id: number }
  | { readonly type: 'CLAIMS'; readonly id: number; readonly next: Identity | null }
  | { readonly type: 'BED'; readonly sleeper: Sleeper }
  | { readonly type: 'ATTENTION'; readonly busy: boolean }
  | { readonly type: 'LETTER'; readonly morning: Morning }
  | { readonly type: 'RESET' }

/** What the machine asks of the game. Each is provided by the story, so the machine stays pure. */
export interface NightEffects {
  readonly nightFalls: () => void
  readonly dayBreaks: () => void
  readonly sleeps: (sleeper: Sleeper) => void
  readonly wakes: (sleeper: Sleeper) => void
  readonly dawnSound: () => void
  readonly signsIn: (next: Identity) => void
  readonly missedMorning: () => void
  readonly deliversLetter: (morning: Morning) => void
}

const letterFor = (context: NightContext, next: Identity, early: boolean): Morning => ({
  next,
  awarded: context.awarded,
  early,
  dawnMs: early ? 0 : context.dawnMs,
})

export const nightMachine = setup({
  types: {
    // SAFETY: XState reads these only as type carriers; the values are never used at runtime.
    context: {} as NightContext,
    // SAFETY: same type-carrier idiom as above.
    events: {} as NightEvent,
  },
  delays: {
    dawn: ({ context }) => context.morning?.dawnMs ?? 0,
  },
  guards: {
    current: ({ context, event }) => 'id' in event && event.id === context.id,
    arrived: ({ context }) => context.minPassed && context.settled && context.next !== null,
    missed: ({ context }) => context.minPassed && context.settled && context.next === null,
    attentionFree: ({ context }) => !context.busy,
  },
  actions: {
    // Provided by the story; these do nothing on their own.
    nightFalls: () => {},
    dayBreaks: () => {},
    sleeps: () => {},
    wakes: () => {},
    dawnSound: () => {},
    signsIn: () => {},
    missedMorning: () => {},
    deliversLetter: () => {},
  },
}).createMachine({
  id: 'night',
  type: 'parallel',
  context: {
    id: 0,
    awarded: [],
    dawnMs: 0,
    minPassed: false,
    settled: false,
    next: null,
    sleeper: null,
    busy: false,
    morning: null,
  },
  on: { ATTENTION: { actions: assign(({ event }) => ({ busy: event.busy })) } },
  states: {
    night: {
      initial: 'day',
      // A game that was reset or left drops its night, and wakes whoever is asleep on the way out.
      on: { RESET: { target: '.day' } },
      states: {
        day: {
          on: {
            FALL: {
              target: 'dusk',
              actions: assign(({ context, event }) => ({
                id: context.id + 1,
                awarded: event.awarded,
                dawnMs: event.dawnMs,
                minPassed: false,
                settled: false,
                next: null,
                sleeper: null,
              })),
            },
          },
        },

        // Looking at the session once, to see whether Pomerium has already refreshed it.
        dusk: {
          on: {
            FRESH: {
              guard: 'current',
              target: 'day',
              actions: [
                assign(({ event }) => ({ next: event.next })),
                'signsIn',
                raise(({ context }) => ({
                  type: 'LETTER' as const,
                  // SAFETY: the assign above has just set `next` from the FRESH event.
                  morning: letterFor(context, context.next as Identity, true),
                })),
              ],
            },
            STALE: { guard: 'current', target: 'dark' },
          },
        },

        dark: {
          initial: 'awake',
          entry: 'nightFalls',
          exit: 'dayBreaks',
          // However soon the claims arrive, night lasts long enough to be seen.
          after: { [MIN_NIGHT_MS]: { actions: assign({ minPassed: true }) } },
          on: {
            CLAIMS: {
              guard: 'current',
              actions: assign(({ event }) => ({ settled: true, next: event.next })),
            },
          },
          always: [
            {
              guard: 'arrived',
              target: 'day',
              actions: [
                'dawnSound',
                'signsIn',
                raise(({ context }) => ({
                  type: 'LETTER' as const,
                  // SAFETY: the `arrived` guard has just checked that `next` is set.
                  morning: letterFor(context, context.next as Identity, false),
                })),
              ],
            },
            { guard: 'missed', target: 'day', actions: 'missedMorning' },
          ],
          states: {
            awake: {
              on: { BED: { target: 'asleep', actions: assign(({ event }) => ({ sleeper: event.sleeper })) } },
            },
            asleep: {
              entry: 'sleeps',
              exit: 'wakes',
            },
          },
        },
      },
    },

    // The morning letter waits out the dawn, then for the player's attention to be free.
    letter: {
      initial: 'none',
      states: {
        none: {
          on: {
            LETTER: { target: 'dawning', actions: assign(({ event }) => ({ morning: event.morning })) },
          },
        },
        dawning: {
          after: { dawn: 'waiting' },
          on: { LETTER: { actions: assign(({ event }) => ({ morning: event.morning })) } },
        },
        waiting: {
          always: { guard: 'attentionFree', target: 'none', actions: 'deliversLetter' },
          on: { LETTER: { actions: assign(({ event }) => ({ morning: event.morning })) } },
        },
      },
    },
  },
})

/** Starts the night's machine with the game's effects. */
export function startNightActor(effects: NightEffects) {
  const actor = createActor(
    nightMachine.provide({
      actions: {
        nightFalls: effects.nightFalls,
        dayBreaks: effects.dayBreaks,
        sleeps: ({ context }) => context.sleeper && effects.sleeps(context.sleeper),
        wakes: ({ context }) => context.sleeper && effects.wakes(context.sleeper),
        dawnSound: effects.dawnSound,
        signsIn: ({ context }) => context.next && effects.signsIn(context.next),
        missedMorning: effects.missedMorning,
        deliversLetter: ({ context }) => context.morning && effects.deliversLetter(context.morning),
      },
    }),
  ).start()

  const snapshot = () => actor.getSnapshot()
  let busy = false

  return {
    /** Night falls; returns its id, which the answers to its questions carry back. */
    fall: (awarded: readonly string[], dawnMs: number) => {
      actor.send({ type: 'FALL', awarded, dawnMs })

      return snapshot().context.id
    },
    /** Whether the night with this id is still under way: not reset, not replaced, not over. */
    current: (id: number) => snapshot().context.id === id && !snapshot().matches({ night: 'day' }),
    day: () => snapshot().matches({ night: 'day' }),
    dark: () => snapshot().matches({ night: 'dark' }),
    fresh: (id: number, next: Identity) => actor.send({ type: 'FRESH', id, next }),
    stale: (id: number) => actor.send({ type: 'STALE', id }),
    claims: (id: number, next: Identity | null) => actor.send({ type: 'CLAIMS', id, next }),
    bed: (sleeper: Sleeper) => actor.send({ type: 'BED', sleeper }),
    /** Tells the letter whether something has the player's attention; only changes are sent. */
    attention: (now: boolean) => {
      if (now === busy) return
      busy = now
      actor.send({ type: 'ATTENTION', busy: now })
    },
    reset: () => actor.send({ type: 'RESET' }),
    stop: () => actor.stop(),
  }
}
