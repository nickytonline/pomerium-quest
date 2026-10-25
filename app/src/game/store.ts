// Shared state between the Phaser scene and the React UI. The scene writes to it (dialog,
// denials, log, progress); React renders it and reports button presses back.
import { useSyncExternalStore } from 'react'
import type { DocLink, LessonId, Page } from './content.ts'
import type { EvalLine, Identity } from './ppl.ts'
import {
  persist,
  questActor,
  resetQuest,
  type Defeated,
  type QuestEvent,
  type QuestStage,
} from './quest-machine.ts'

export type Dir = 'down' | 'up' | 'right' | 'left'

export type Mode = 'loading' | 'pomerium' | 'simulated'

export interface Progress {
  readonly x: number
  readonly y: number
  readonly dir: Dir
  readonly lessons: readonly LessonId[]
  readonly brokenRocks: readonly string[]
  /** Half hearts the town fountain has restored this game (it gives at most FOUNTAIN_LIMIT). */
  readonly fountainHealed: number
  /** Half hearts pond fish have restored this game (at most FISH_LIMIT). */
  readonly fishEaten: number
  /** True once a game has been started, so the title screen offers Continue. */
  readonly playedBefore: boolean
  /** Simulated-mode identity; in Pomerium mode the identity comes from the session. */
  readonly sim: {
    readonly signedIn: boolean
    readonly groups: readonly string[]
    readonly pendingGroups: readonly string[]
  }
}

export interface DenyView {
  readonly status: 401 | 403
  readonly title: string
  /** The refusal as the kingdom tells it, shown first; the rest is how Pomerium decided. */
  readonly story: { readonly title: string; readonly text: string }
  /** Set when the denial belongs to someone else (an NPC), so the screen doesn't read as the player's. */
  readonly onBehalfOf?: string
  readonly requestLine: string
  readonly who: string
  readonly lines: readonly EvalLine[]
  readonly hint: string
  readonly links: readonly DocLink[]
  /** Pomerium's request ID for this decision, when it came from a real Pomerium. */
  readonly requestId?: string
}

export interface LogEntry {
  readonly id: number
  readonly at: string
  readonly decision: 'ALLOW' | 'DENY' | 'SIGN IN'
  readonly method: string
  readonly path: string
  readonly who: string
}

export interface Toast {
  readonly id: number
  readonly text: string
  readonly tone: 'allow' | 'deny' | 'info'
}

export interface Controls {
  readonly dir: Dir | null
  readonly interact: number
  readonly attack: number
}

export interface QuestState {
  readonly started: boolean
  readonly mode: Mode
  readonly identity: Identity
  readonly region: string
  readonly hp: number
  readonly dialog: { readonly pages: readonly Page[]; readonly index: number } | null
  readonly deny: DenyView | null
  readonly toast: Toast | null
  readonly log: readonly LogEntry[]
  readonly progress: Progress
  /** Mirrors the quest machine so React can render it. */
  readonly stage: QuestStage
  readonly defeated: Defeated
  readonly controls: Controls
  /** Timestamp until which the scene ignores input, so the key that closed a dialog does not reopen it. */
  readonly inputResumesAt: number
  readonly menuOpen: boolean
  /** The Oracle's sign-in, running through Pomerium in a frame over the game. Pauses the game. */
  readonly signIn: { readonly url: string } | null
  /** The Journal drawer, used when the panels can't sit beside the game. Pauses the game while open. */
  readonly journalOpen: boolean
  /** Something new reached the Journal (a log entry, lesson or identity change) since it was last open. */
  readonly journalUnread: boolean
  /** When the player last saved explicitly (progress also saves on every step). */
  readonly savedAt: string | null
}

/** Health is counted in half hearts: 10 is five full hearts. */
export const MAX_HP = 10

/** A short buzz on phones that support it (not iPhones); nothing depends on it. */
export const buzz = (pattern: number | number[]) => {
  if ('vibrate' in navigator) navigator.vibrate(pattern)
}

export const ANONYMOUS: Identity = { authenticated: false, email: '', groups: [] }
const STORAGE_KEY = 'pomerium-quest/progress/v1'

const freshProgress = (): Progress => ({
  x: 9,
  y: 25,
  dir: 'right',
  lessons: [],
  brokenRocks: [],
  fountainHealed: 0,
  fishEaten: 0,
  playedBefore: false,
  sim: { signedIn: false, groups: [], pendingGroups: [] },
})

function loadProgress(): Progress {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)

    // SAFETY: written only by saveProgress below; a missing field falls back to a fresh value.
    return raw ? { ...freshProgress(), ...(JSON.parse(raw) as Partial<Progress>) } : freshProgress()
  } catch {
    return freshProgress()
  }
}

function saveProgress(progress: Progress) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // Storage can be unavailable (private windows); progress then lasts for this tab only.
  }
}

let state: QuestState = {
  started: false,
  mode: 'loading',
  identity: ANONYMOUS,
  region: 'Hearth Village',
  hp: MAX_HP,
  dialog: null,
  deny: null,
  toast: null,
  log: [],
  progress: loadProgress(),
  stage: questActor.getSnapshot().value,
  defeated: questActor.getSnapshot().context.defeated,
  controls: { dir: null, interact: 0, attack: 0 },
  inputResumesAt: 0,
  menuOpen: false,
  signIn: null,
  journalOpen: false,
  journalUnread: false,
  savedAt: null,
}

const listeners = new Set<() => void>()
let dialogDone: (() => void) | undefined
let denyDone: (() => void) | undefined
let signedIn: (() => void) | undefined
let nextId = 1

/** A change the Journal shows; flags it unread unless the drawer is open. */
const noted = (patch: Partial<QuestState>) => ({
  ...patch,
  journalUnread: state.journalUnread || !state.journalOpen,
})

function update(patch: Partial<QuestState>) {
  state = { ...state, ...patch }

  for (const listener of listeners) listener()
}

export const quest = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => listeners.delete(listener)
  },
  isPaused: () =>
    state.dialog !== null ||
    state.deny !== null ||
    state.signIn !== null ||
    state.menuOpen ||
    state.journalOpen ||
    !state.started,

  start: () => update({ started: true }),
  openMenu: () => {
    if (state.started && !state.dialog && !state.deny) update({ menuOpen: true, journalOpen: false })
  },
  closeMenu: () => update({ menuOpen: false, inputResumesAt: performance.now() + 200 }),
  openJournal: () => {
    if (state.started && !state.dialog && !state.deny)
      update({ journalOpen: true, journalUnread: false, menuOpen: false })
  },
  closeJournal: () => {
    if (state.journalOpen) update({ journalOpen: false, inputResumesAt: performance.now() + 200 })
  },
  save: () => {
    saveProgress(state.progress)
    persist()
    const savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    update({ savedAt })
    quest.toast('Game saved', 'info')
  },
  /** Back to the title screen. The scene is rebuilt from saved progress on Continue. */
  quit: () => {
    quest.save()
    update({ started: false, menuOpen: false, journalOpen: false, dialog: null, deny: null })
  },
  setMode: (mode: Mode, identity: Identity) => update({ mode, identity }),
  setIdentity: (identity: Identity) => update(noted({ identity })),
  setRegion: (region: string) => {
    if (region !== state.region) update({ region })
  },
  setHp: (hp: number) => update({ hp }),

  progress: (patch: Partial<Progress>) => {
    const progress = { ...state.progress, ...patch }
    saveProgress(progress)
    update({ progress })
  },
  send: (event: QuestEvent) => {
    questActor.send(event)
    persist()
    const snapshot = questActor.getSnapshot()
    update({ stage: snapshot.value, defeated: snapshot.context.defeated })
  },
  learn: (lesson: LessonId, title: string) => {
    if (state.progress.lessons.includes(lesson)) return
    quest.progress({ lessons: [...state.progress.lessons, lesson] })
    update(noted({}))
    quest.toast(`Lesson learned: ${title}`, 'info')
  },
  resetProgress: () => {
    const progress = freshProgress()
    saveProgress(progress)
    resetQuest()
    update({
      progress,
      hp: MAX_HP,
      log: [],
      stage: questActor.getSnapshot().value,
      defeated: questActor.getSnapshot().context.defeated,
    })
  },

  say: (pages: readonly Page[], onDone?: () => void) => {
    dialogDone = onDone
    update({ dialog: { pages, index: 0 } })
  },
  advance: () => {
    const dialog = state.dialog

    if (!dialog) return

    if (dialog.index + 1 < dialog.pages.length) {
      update({ dialog: { ...dialog, index: dialog.index + 1 } })

      return
    }

    const done = dialogDone
    dialogDone = undefined
    update({ dialog: null, inputResumesAt: performance.now() + 200 })
    done?.()
  },

  showDeny: (deny: DenyView, onDone?: () => void) => {
    denyDone = onDone
    buzz([40, 30, 40])
    update({ deny })
  },
  closeDeny: () => {
    const done = denyDone
    denyDone = undefined
    update({ deny: null, inputResumesAt: performance.now() + 200 })
    done?.()
  },

  openSignIn: (url: string, onSignedIn: () => void) => {
    signedIn = onSignedIn
    update({ signIn: { url }, menuOpen: false, journalOpen: false })
  },
  finishSignIn: () => {
    const done = signedIn
    signedIn = undefined
    update({ signIn: null, inputResumesAt: performance.now() + 200 })
    done?.()
  },
  cancelSignIn: () => {
    signedIn = undefined
    update({ signIn: null, inputResumesAt: performance.now() + 200 })
  },

  toast: (text: string, tone: Toast['tone']) => update({ toast: { id: nextId++, text, tone } }),
  clearToast: (id: number) => {
    if (state.toast?.id === id) update({ toast: null })
  },

  log: (entry: Omit<LogEntry, 'id' | 'at'>) => {
    const at = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    update(noted({ log: [{ ...entry, id: nextId++, at }, ...state.log].slice(0, 40) }))
  },

  press: (control: 'interact' | 'attack') =>
    update({ controls: { ...state.controls, [control]: state.controls[control] + 1 } }),
  hold: (dir: Dir | null) => update({ controls: { ...state.controls, dir } }),
}

export function useQuest<T>(select: (s: QuestState) => T): T {
  return useSyncExternalStore(
    quest.subscribe,
    () => select(state),
    () => select(state),
  )
}
