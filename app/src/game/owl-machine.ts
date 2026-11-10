// Chapter two's progression as a statechart: the owl, an MCP client, runs errands on the player's behalf.
//
//   afar → arrived → seeking → fledged → turned → vouched → falconer → entrusted → keyholder → triumphant
//
// `vouched` and `entrusted` are stale sessions, like chapter one's `knighted`: the Oracle has added a group
// (the Falconer wrote for falconers, the owl's letter for keyholders), but the player's Pomerium session
// still holds the claims from sign-in. A sign-in that already carries a group (a second browser, say) moves
// straight to the stage that group earns. Finding Mochi's falcon can happen at any point, so it is kept
// beside the stages, not among them.
import { assign, createActor, setup, type SnapshotFrom } from 'xstate'
import { GROUPS } from './groups.ts'

export type OwlEvent =
  | { readonly type: 'KEEP_ENTERED' }
  | { readonly type: 'OWL_SOUGHT' }
  | { readonly type: 'OWL_CAUGHT' }
  | { readonly type: 'OWL_TURNED_BACK' }
  | { readonly type: 'FALCONER_VOUCHED' }
  | { readonly type: 'LETTER_DELIVERED' }
  | { readonly type: 'SIGNED_IN'; readonly groups: readonly string[] }
  | { readonly type: 'FALCON_FOUND' }
  | { readonly type: 'REUNITED' }

interface OwlContext {
  /** The player has found Mochi's falcon, which follows them from then on. */
  readonly falconFound: boolean
}

const toKeyholder = { guard: 'hasKeyholdersClaim', target: 'keyholder' } as const
const toFalconer = { guard: 'hasFalconersClaim', target: 'falconer' } as const

export const owlMachine = setup({
  types: {
    // SAFETY: XState reads this only as a type carrier; the value is never used at runtime.
    events: {} as OwlEvent,
    // SAFETY: a type carrier too; the machine's real starting context is set in createMachine below.
    context: {} as OwlContext,
  },
  actions: {
    find: assign({ falconFound: true }),
  },
  guards: {
    hasFalconersClaim: ({ event }) => event.type === 'SIGNED_IN' && event.groups.includes(GROUPS.falconers),
    hasKeyholdersClaim: ({ event }) => event.type === 'SIGNED_IN' && event.groups.includes(GROUPS.keyholders),
    hasFalcon: ({ context }) => context.falconFound,
  },
}).createMachine({
  id: 'owl',
  initial: 'afar',
  context: { falconFound: false },
  // The falcon is in the open ground, so it can be found whatever the owl's errands have come to.
  on: { FALCON_FOUND: { actions: 'find' } },
  states: {
    afar: {
      description: 'Chapter two lies beyond the Royal Keep.',
      on: { KEEP_ENTERED: 'arrived', SIGNED_IN: [toKeyholder, toFalconer] },
    },
    arrived: {
      description: 'Through the keep. The Falconer is waiting just inside.',
      on: { OWL_SOUGHT: 'seeking', SIGNED_IN: [toKeyholder, toFalconer] },
    },
    seeking: {
      description: 'To become a falconer, catch your owl. It is somewhere in the open ground.',
      on: { OWL_CAUGHT: 'fledged', SIGNED_IN: [toKeyholder, toFalconer] },
    },
    fledged: {
      description: 'You caught your owl: an MCP client that flies on your behalf. Send it to a perch.',
      on: {
        OWL_TURNED_BACK: 'turned',
        SIGNED_IN: [toKeyholder, toFalconer],
      },
    },
    turned: {
      description: `Pomerium turned the owl back: the Aviary's route asks for '${GROUPS.falconers}', and your session has no such group.`,
      on: {
        FALCONER_VOUCHED: 'vouched',
        SIGNED_IN: [toKeyholder, toFalconer],
      },
    },
    vouched: {
      description: `The Falconer had the identity provider add '${GROUPS.falconers}', but the session holds older claims.`,
      on: { SIGNED_IN: [toKeyholder, toFalconer] },
    },
    falconer: {
      description: `The session carries '${GROUPS.falconers}': the Aviary lets your owl in, except to the open_ tools.`,
      on: { LETTER_DELIVERED: 'entrusted', SIGNED_IN: toKeyholder },
    },
    entrusted: {
      description: `A tool call had the identity provider add '${GROUPS.keyholders}', but the session holds older claims.`,
      on: { SIGNED_IN: toKeyholder },
    },
    keyholder: {
      description: `The session carries '${GROUPS.keyholders}': the Eyrie's gate, the last one, will open.`,
      on: { REUNITED: { guard: 'hasFalcon', target: 'triumphant' } },
    },
    triumphant: {
      description: 'You brought Mochi their falcon. Chapter two, and the quest, are complete.',
    },
  },
})

export type OwlStage = SnapshotFrom<typeof owlMachine>['value']

const STORAGE_KEY = 'pomerium-quest/owl/v1'

type OwlSnapshot = SnapshotFrom<typeof owlMachine>

/** Stages an older version of the chapter had, and where a save that stopped there picks up now. */
const LEGACY_STAGES: ReadonlyMap<string, OwlStage> = new Map([['crowned', 'keyholder']])

/**
 * Brings a saved snapshot up to this version of the machine: a stage that no longer exists becomes the one
 * that replaced it, and a save from before the falcon hasn't found it.
 */
export function migrate(saved: {
  readonly value: string
  readonly context?: Partial<OwlContext> | undefined
}): OwlSnapshot {
  // SAFETY: a persisted snapshot is plain data; only the two fields this function sets differ by version.
  return {
    ...saved,
    value: LEGACY_STAGES.get(saved.value) ?? saved.value,
    context: { falconFound: false, ...saved.context },
  } as OwlSnapshot
}

function restore() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

    // SAFETY: written by persistOwl() below from actor.getPersistedSnapshot(), by this version or an older one.
    return raw ? migrate(JSON.parse(raw) as Parameters<typeof migrate>[0]) : undefined
  } catch {
    return undefined
  }
}

function start(snapshot = restore()) {
  try {
    return createActor(owlMachine, snapshot ? { snapshot } : {}).start()
  } catch {
    // A snapshot from an older machine version: start over rather than crash.
    return createActor(owlMachine).start()
  }
}

export let owlActor = start()

export function persistOwl() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(owlActor.getPersistedSnapshot()))
  } catch {
    // Storage unavailable; the owl's progress lasts for this tab only.
  }
}

export function resetOwl() {
  owlActor.stop()

  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored.
  }

  owlActor = start(undefined)
}

export const owlStage = (): OwlStage => owlActor.getSnapshot().value

const ORDER: readonly OwlStage[] = [
  'afar',
  'arrived',
  'seeking',
  'fledged',
  'turned',
  'vouched',
  'falconer',
  'entrusted',
  'keyholder',
  'triumphant',
]

/** Whether the owl's story has reached `target`. */
export const owlAtLeast = (target: OwlStage) => ORDER.indexOf(owlStage()) >= ORDER.indexOf(target)

/** Whether the player has found Mochi's falcon. */
export const falconFound = () => owlActor.getSnapshot().context.falconFound
