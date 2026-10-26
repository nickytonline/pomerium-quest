// Chapter one's progression as a statechart. Each state is a step in how the player's
// identity changes, which is what the chapter teaches:
//
//   anonymous → citizen → proven → knighted → knight → armed
//
// `knighted` is the important one: the Oracle (identity provider) now lists the player
// in the knights group, but their Pomerium session still holds the claims from sign-in,
// so the armory still says no until they sign in again.
import { assign, createActor, setup, type SnapshotFrom } from 'xstate'

/** The Captain vouches for anyone who has cleared this many of each monster kind. */
export const KNIGHT_QUOTA = 3

/** Phish aren't monsters: they're fake Oracles, and a sword is no defense against them. */
export type MonsterKind = 'bot'

export type Defeated = Readonly<Record<MonsterKind, number>>

export const MONSTER_KINDS: readonly MonsterKind[] = ['bot']

export const isProven = (defeated: Defeated) => MONSTER_KINDS.every((kind) => defeated[kind] >= KNIGHT_QUOTA)

export type QuestEvent =
  | { readonly type: 'SIGNED_IN'; readonly groups: readonly string[] }
  | { readonly type: 'SIGNED_OUT' }
  | { readonly type: 'MONSTER_DEFEATED'; readonly kind: MonsterKind }
  | { readonly type: 'KNIGHTED' }
  | { readonly type: 'STEEL_TAKEN' }

export interface QuestContext {
  readonly defeated: Defeated
}

export const questMachine = setup({
  types: {
    // SAFETY: XState reads these only as type carriers; the values are never used at runtime.
    context: {} as QuestContext,
    // SAFETY: same type-carrier idiom as above.
    events: {} as QuestEvent,
  },
  guards: {
    proven: ({ context }) => isProven(context.defeated),
    hasKnightsClaim: ({ event }) => event.type === 'SIGNED_IN' && event.groups.includes('knights'),
  },
}).createMachine({
  id: 'quest',
  initial: 'anonymous',
  context: { defeated: { bot: 0 } },
  on: {
    MONSTER_DEFEATED: {
      actions: assign({
        defeated: ({ context, event }) => ({
          ...context.defeated,
          [event.kind]: context.defeated[event.kind] + 1,
        }),
      }),
    },
  },
  states: {
    anonymous: {
      description: 'No session. Every guard sends you to the identity provider.',
      on: { SIGNED_IN: 'citizen' },
    },
    citizen: {
      description: 'Signed in with the citizen claim; no other groups yet.',
      always: { guard: 'proven', target: 'proven' },
      on: { SIGNED_OUT: 'anonymous' },
    },
    proven: {
      description: 'Has defeated enough bot slimes for the Captain to vouch for them.',
      on: { KNIGHTED: 'knighted', SIGNED_OUT: 'anonymous' },
    },
    knighted: {
      description: "The identity provider lists 'knights', but the Pomerium session holds older claims.",
      on: { SIGNED_IN: { guard: 'hasKnightsClaim', target: 'knight' } },
    },
    knight: {
      description: 'The session carries groups: [knights]; the armory policy matches.',
      on: { STEEL_TAKEN: 'armed' },
    },
    armed: {
      description: 'Holds the steel sword; can break the rocks to the library.',
    },
  },
})

export type QuestStage = SnapshotFrom<typeof questMachine>['value']

const STORAGE_KEY = 'pomerium-quest/machine/v1'

function restore() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

    if (!raw) return undefined
    // SAFETY: written by persist() below from actor.getPersistedSnapshot().
    const snapshot = JSON.parse(raw) as SnapshotFrom<typeof questMachine>
    // SAFETY: saves from before defeated bot slimes were counted by kind kept one `xp` total.
    const legacy = snapshot.context as Partial<QuestContext> & { readonly xp?: number }

    return legacy.defeated ? snapshot : { ...snapshot, context: { defeated: { bot: legacy.xp ?? 0 } } }
  } catch {
    return undefined
  }
}

function start(snapshot = restore()) {
  try {
    return createActor(questMachine, snapshot ? { snapshot } : {}).start()
  } catch {
    // A snapshot from an older machine version: start over rather than crash.
    return createActor(questMachine).start()
  }
}

export let questActor = start()

export function persist() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(questActor.getPersistedSnapshot()))
  } catch {
    // Storage unavailable; progression lasts for this tab only.
  }
}

export function resetQuest() {
  questActor.stop()

  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored.
  }

  questActor = start(undefined)
}

export const stage = (): QuestStage => questActor.getSnapshot().value
export const defeated = () => questActor.getSnapshot().context.defeated
export const hasSteel = () => stage() === 'armed'

export const isAtLeast = (target: QuestStage) => {
  const order: readonly QuestStage[] = ['anonymous', 'citizen', 'proven', 'knighted', 'knight', 'armed']

  return order.indexOf(stage()) >= order.indexOf(target)
}
