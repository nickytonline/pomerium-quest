// Shared state between the Phaser scene and the React UI. The scene writes to it (dialog,
// denials, log, progress); React renders it and reports button presses back.
import { useSyncExternalStore } from 'react'
import type { Choice, DocLink, LessonId, Page } from './content.ts'
import type { HouseRule, HouseState } from './house.ts'
import { houseActor, persistHouse, resetHouse, type HouseEvent, type HouseStage } from './house-machine.ts'
import { owlActor, persistOwl, resetOwl, type OwlEvent, type OwlStage } from './owl-machine.ts'
import type { OwlTool } from './owl.ts'
import type { OwlFlight, PerchPhase } from './perch.ts'
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

/** unreachable: the game was opened without Pomerium in front of it, so nothing can be played. */
export type Mode = 'loading' | 'pomerium' | 'unreachable'

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
  /** Phish (by index into the world's list) the player refused to sign in with; they don't come back. */
  readonly phishTurnedAway: readonly number[]
  /** Which of the library's books the player has read (indexes into BOOKS). */
  readonly booksRead: readonly number[]
  /** The Librarian has vouched for the player, so the Oracle lists them as a scholar. */
  readonly scholar: boolean
  /** True once a game has been started, so the title screen offers Continue. */
  readonly playedBefore: boolean
  /** The door rules the player last saved; null while their house is still public. */
  readonly houseRules: readonly HouseRule[] | null
}

export interface DenyView {
  /** 200 is a refused MCP request: Pomerium answers those with a JSON-RPC error an MCP client can read. */
  readonly status: 401 | 403 | 200
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
  /** A refused MCP tool call: the JSON-RPC request the owl carried, and what Pomerium sent back. */
  readonly rpc?: { readonly request: string; readonly response: string | null }
  /** Pomerium's request ID for this decision, when it came from a real Pomerium. */
  readonly requestId?: string
  /**
   * Set when Pomerium refused a session whose claims qualify: its authorize step merged them with
   * the user record it cached, whose groups are older. cached is null when the game can't tell
   * what they were (the page was reloaded since signing in again).
   */
  readonly cachedClaims?: { readonly session: readonly string[]; readonly cached: readonly string[] | null }
}

/** The perch the player is at, and the errand under way there. */
export interface PerchView {
  /** The Aviary's tool this perch stands for. */
  readonly tool: OwlTool
  /** The owl's last flight to this perch: the MCP request and Pomerium's answer. */
  readonly flight: OwlFlight | null
  /** How far the errand has got: the scene flies the owl to match. */
  readonly phase: PerchPhase
  /** The player asked to read what the owl brought back, so the perch's panel is open. */
  readonly explained: boolean
}

/**
 * The Falconer's owl, sent to the cage on the Falconer's behalf. It flies out with the request, comes back
 * with Mochi's owl beside it, and then what it carried can be read.
 */
export interface FalconersErrand {
  /** The flight, once the owl is back: the MCP request and Pomerium's answer. */
  readonly flight: OwlFlight | null
  /** How far the errand has got: the scene flies the Falconer's owl, and Mochi's, to match. */
  readonly phase: 'out' | 'opening' | 'back' | 'done'
  /** The player asked to read what the owl brought back, so its panel is open. */
  readonly explained: boolean
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
  /** It is night: the game waits for Pomerium's token to carry the Oracle's new claims, then morning comes. */
  readonly night: boolean
  /** The player is asleep in a bed during the night. */
  readonly sleeping: boolean
  /** The Royal Keep let the player in: chapter one is complete. */
  readonly finale: boolean
  /** After chapter two's ending: fireworks, a happy Pomeranian and the cast. */
  readonly celebrating: boolean
  /** The player signed in with a phish: the game is lost and can only start over. */
  readonly phished: boolean
  /** The Journal drawer, used when the panels can't sit beside the game. Pauses the game while open. */
  readonly journalOpen: boolean
  /** Something new reached the Journal (a log entry, lesson or identity change) since it was last open. */
  readonly journalUnread: boolean
  /** When the player last saved explicitly (progress also saves on every step). */
  readonly savedAt: string | null
  /** Mirrors the house machine so React can render it. */
  readonly houseStage: HouseStage
  readonly letterRead: boolean
  /** The player's house as the server last reported it; null until they first go in. */
  readonly house: HouseState | null
  /** The door rules editor is open at the desk. Pauses the game. */
  readonly houseEditor: boolean
  /** Mirrors the owl machine so React can render it. */
  readonly owlStage: OwlStage
  /** The perch the player is sending the owl from, until they leave it. Pauses the game. */
  readonly perch: PerchView | null
  /** The errand the Falconer's owl is on, until the player has read it or walked away. Pauses the game. */
  readonly falconersErrand: FalconersErrand | null
  /** The player brought Mochi their owl in the Eyrie: chapter two, and the quest, are complete. */
  readonly chapterTwoDone: boolean
}

/** Health is counted in half hearts: 10 is five full hearts. */
export const MAX_HP = 10

/** How long a just-shown answer or button ignores clicks, so a key meant for the last screen can't press it. */
export const SETTLE_MS = 250

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
  phishTurnedAway: [],
  booksRead: [],
  scholar: false,
  playedBefore: false,
  houseRules: null,
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
  night: false,
  sleeping: false,
  finale: false,
  celebrating: false,
  phished: false,
  journalOpen: false,
  journalUnread: false,
  savedAt: null,
  houseStage: houseActor.getSnapshot().value,
  letterRead: houseActor.getSnapshot().context.letterRead,
  house: null,
  houseEditor: false,
  owlStage: owlActor.getSnapshot().value,
  perch: null,
  falconersErrand: null,
  chapterTwoDone: false,
}

const listeners = new Set<() => void>()
let dialogDone: (() => void) | undefined
let denyDone: (() => void) | undefined
let signedIn: (() => void) | undefined
let signInCancelled: (() => void) | undefined
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

/** Whether something has the player's attention (a dialog, a menu, a screen), so the game waits for it. */
export const paused = (s: QuestState) =>
  s.dialog !== null ||
  s.deny !== null ||
  s.signIn !== null ||
  s.sleeping ||
  s.finale ||
  s.celebrating ||
  s.phished ||
  s.menuOpen ||
  s.journalOpen ||
  s.houseEditor ||
  s.perch !== null ||
  s.falconersErrand !== null ||
  s.chapterTwoDone ||
  !s.started

export const quest = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener)

    return () => listeners.delete(listener)
  },
  isPaused: () => paused(state),

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
    update({
      started: false,
      menuOpen: false,
      journalOpen: false,
      dialog: null,
      deny: null,
      night: false,
      sleeping: false,
      finale: false,
      celebrating: false,
      perch: null,
      falconersErrand: null,
      chapterTwoDone: false,
    })
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
  /** Tells the quest someone signed in. A session holding the deed owns a house, whichever browser it's in. */
  signedIn: (identity: Identity) => {
    quest.send({ type: 'SIGNED_IN', groups: identity.groups })
    quest.sendOwl({ type: 'SIGNED_IN', groups: identity.groups })

    if (identity.deed) quest.sendHouse({ type: 'DEED_GIVEN' })
  },
  sendHouse: (event: HouseEvent) => {
    houseActor.send(event)
    persistHouse()
    const snapshot = houseActor.getSnapshot()
    update(noted({ houseStage: snapshot.value, letterRead: snapshot.context.letterRead }))
  },
  sendOwl: (event: OwlEvent) => {
    owlActor.send(event)
    persistOwl()
    update(noted({ owlStage: owlActor.getSnapshot().value }))
  },
  /** The owl hops onto the perch, and waits there while the player is asked whether to send it. */
  openPerch: (tool: OwlTool) =>
    update({
      perch: { tool, flight: null, phase: 'asking', explained: false },
      menuOpen: false,
      journalOpen: false,
    }),
  /** The owl sets off, lands or is turned back; the scene flies it to match. */
  perchPhase: (phase: PerchPhase) => {
    if (state.perch) update({ perch: { ...state.perch, phase } })
  },
  /** The owl is back on the perch with its answer, which waits until the player asks to read it. */
  perchFlew: (flight: OwlFlight) => {
    if (state.perch) update({ perch: { ...state.perch, flight, phase: 'done', explained: false } })
  },
  /** The player asks to read what the owl brought back: the perch's panel opens. */
  explainPerch: () => {
    if (state.perch) update({ perch: { ...state.perch, explained: true } })
  },
  closePerch: () => update({ perch: null, inputResumesAt: performance.now() + 200 }),
  /** The Falconer's owl sets off for the cage. */
  sendFalconersOwl: () =>
    update({
      falconersErrand: { flight: null, phase: 'out', explained: false },
      menuOpen: false,
      journalOpen: false,
    }),
  /** The Falconer's owl is at the cage, and the keeper unlocks it. */
  cageOpens: () => {
    if (state.falconersErrand) update({ falconersErrand: { ...state.falconersErrand, phase: 'opening' } })
  },
  /** The cage is open: the Falconer's owl and Mochi's fly back. */
  falconersOwlReturns: () => {
    if (state.falconersErrand) update({ falconersErrand: { ...state.falconersErrand, phase: 'back' } })
  },
  /** Both owls have landed, and what the Falconer's owl carried waits until the player asks to read it. */
  falconersOwlFlew: (flight: OwlFlight) => {
    if (state.falconersErrand) update({ falconersErrand: { flight, phase: 'done', explained: false } })
  },
  explainFalconersErrand: () => {
    if (state.falconersErrand) update({ falconersErrand: { ...state.falconersErrand, explained: true } })
  },
  closeFalconersErrand: () => update({ falconersErrand: null, inputResumesAt: performance.now() + 200 }),
  openChapterTwoEnd: () => update({ chapterTwoDone: true, menuOpen: false, journalOpen: false }),
  /** Chapter two's ending is the quest's: it leads straight on to the celebration. */
  closeChapterTwoEnd: () => update({ chapterTwoDone: false, celebrating: true }),
  setHouse: (house: HouseState | null) => update({ house }),
  openHouseEditor: () => update({ houseEditor: true, menuOpen: false, journalOpen: false }),
  closeHouseEditor: () => update({ houseEditor: false, inputResumesAt: performance.now() + 200 }),
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
    resetHouse()
    resetOwl()
    update({
      progress,
      owlStage: owlActor.getSnapshot().value,
      houseStage: houseActor.getSnapshot().value,
      letterRead: false,
      house: null,
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

    // A page with choices waits for one to be picked.
    if (!dialog || dialog.pages[dialog.index]?.choices) return

    if (dialog.index + 1 < dialog.pages.length) {
      update({ dialog: { ...dialog, index: dialog.index + 1 } })

      return
    }

    quest.closeDialog()
  },

  /** Skips to the end of a dialog, as if every page were read, unless a choice is still to come. */
  closeDialog: () => {
    const dialog = state.dialog

    if (!dialog || dialog.pages.slice(dialog.index).some((page) => page.choices)) return

    const done = dialogDone
    dialogDone = undefined
    update({ dialog: null, inputResumesAt: performance.now() + 200 })
    done?.()
  },

  /** Closes a page with choices and runs the one picked, instead of the dialog's onDone. */
  choose: (choice: Choice) => {
    dialogDone = undefined
    update({ dialog: null, inputResumesAt: performance.now() + 200 })
    choice.pick()
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

  openSignIn: (url: string, onSignedIn: () => void, onCancel?: () => void) => {
    signedIn = onSignedIn
    signInCancelled = onCancel
    update({ signIn: { url }, menuOpen: false, journalOpen: false })
  },
  finishSignIn: () => {
    const done = signedIn
    signedIn = undefined
    signInCancelled = undefined
    update({ signIn: null, inputResumesAt: performance.now() + 200 })
    done?.()
  },
  cancelSignIn: () => {
    const cancelled = signInCancelled
    signedIn = undefined
    signInCancelled = undefined
    update({ signIn: null, inputResumesAt: performance.now() + 200 })
    cancelled?.()
  },
  setNight: (night: boolean) => update({ night, sleeping: night && state.sleeping }),
  setSleeping: (sleeping: boolean) => update({ sleeping }),
  openFinale: () => update({ finale: true, menuOpen: false, journalOpen: false }),
  /** Chapter one's ending closes onto the Aviary's grounds: chapter two starts on the keep's far side. */
  closeFinale: () => update({ finale: false, inputResumesAt: performance.now() + 200 }),
  endCelebration: () => update({ celebrating: false, inputResumesAt: performance.now() + 200 }),
  fallForPhish: () => update({ phished: true, menuOpen: false, journalOpen: false }),

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
