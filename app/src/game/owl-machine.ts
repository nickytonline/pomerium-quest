// Chapter two's progression as a statechart: the owl, an MCP client, runs errands for the player.
//
//   afar → arrived → fledged → vouched → falconer → entrusted → keyholder → crowned → triumphant
//
// `vouched` and `entrusted` are stale sessions, like chapter one's `knighted`: a tool call had the Oracle
// add a group, but the player's Pomerium session still holds the claims from sign-in. A sign-in that
// already carries a group (a second browser, say) moves straight to the stage that group earns. The vault's
// chest is on the way to the Throne Room, not a lock on it: a keyholder may walk past it to the end.
import { createActor, setup, type SnapshotFrom } from 'xstate'
import { GROUPS } from './groups.ts'

export type OwlEvent =
  | { readonly type: 'KEEP_ENTERED' }
  | { readonly type: 'OWL_GIVEN' }
  | { readonly type: 'LETTER_DELIVERED' }
  | { readonly type: 'VAULT_OPENED' }
  | { readonly type: 'SIGNED_IN'; readonly groups: readonly string[] }
  | { readonly type: 'TREASURE_TAKEN' }
  | { readonly type: 'THRONE_ENTERED' }

const toKeyholder = { guard: 'hasKeyholdersClaim', target: 'keyholder' } as const
const toFalconer = { guard: 'hasFalconersClaim', target: 'falconer' } as const

export const owlMachine = setup({
  types: {
    // SAFETY: XState reads this only as a type carrier; the value is never used at runtime.
    events: {} as OwlEvent,
  },
  guards: {
    hasFalconersClaim: ({ event }) => event.type === 'SIGNED_IN' && event.groups.includes(GROUPS.falconers),
    hasKeyholdersClaim: ({ event }) => event.type === 'SIGNED_IN' && event.groups.includes(GROUPS.keyholders),
  },
}).createMachine({
  id: 'owl',
  initial: 'afar',
  states: {
    afar: {
      description: 'Chapter two lies beyond the Royal Keep.',
      on: { KEEP_ENTERED: 'arrived', SIGNED_IN: [toKeyholder, toFalconer] },
    },
    arrived: {
      description: 'Through the keep. The Falconer has an owl for you.',
      on: { OWL_GIVEN: 'fledged', SIGNED_IN: [toKeyholder, toFalconer] },
    },
    fledged: {
      description: 'The owl flies for you: an MCP client, calling the Aviary’s tools as you.',
      on: { LETTER_DELIVERED: 'vouched', SIGNED_IN: [toKeyholder, toFalconer] },
    },
    vouched: {
      description: `A tool call had the identity provider add '${GROUPS.falconers}', but the session holds older claims.`,
      on: { SIGNED_IN: [toKeyholder, toFalconer] },
    },
    falconer: {
      description: `The session carries '${GROUPS.falconers}': the Mews opens, and so does the Rookery's route.`,
      on: { VAULT_OPENED: 'entrusted', SIGNED_IN: toKeyholder },
    },
    entrusted: {
      description: `A tool call had the identity provider add '${GROUPS.keyholders}', but the session holds older claims.`,
      on: { SIGNED_IN: toKeyholder },
    },
    keyholder: {
      description: `The session carries '${GROUPS.keyholders}'; the vault's policy matches.`,
      on: { TREASURE_TAKEN: 'crowned', THRONE_ENTERED: 'triumphant' },
    },
    crowned: {
      description: 'The Royal Seal is yours. The Throne Room is the last gate.',
      on: { THRONE_ENTERED: 'triumphant' },
    },
    triumphant: {
      description: 'The Throne Room let you in. Chapter two, and the quest, are complete.',
    },
  },
})

export type OwlStage = SnapshotFrom<typeof owlMachine>['value']

const STORAGE_KEY = 'pomerium-quest/owl/v1'

function restore() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

    // SAFETY: written by persistOwl() below from actor.getPersistedSnapshot().
    return raw ? (JSON.parse(raw) as SnapshotFrom<typeof owlMachine>) : undefined
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
  'fledged',
  'vouched',
  'falconer',
  'entrusted',
  'keyholder',
  'crowned',
  'triumphant',
]

/** Whether the owl's story has reached `target`. */
export const owlAtLeast = (target: OwlStage) => ORDER.indexOf(owlStage()) >= ORDER.indexOf(target)
