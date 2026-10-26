import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { probe } from '../game/access.ts'
import { SHEETS } from '../game/sheets.ts'
import { Celebration, playAgain } from './Celebration.tsx'
import { HouseEditor, VisitsScreen } from './House.tsx'
import { Phished } from './Phished.tsx'
import { PolicyLines } from './PolicyLines.tsx'
import { TAB_EVENT, TabbedScreen, switchTab, tabHint } from './TabbedScreen.tsx'
import { INTRO, LESSONS, LESSON_ORDER, type Choice } from '../game/content.ts'
import { KNIGHT_QUOTA, questMachine, type QuestStage } from '../game/quest-machine.ts'
import { MAX_HP, SETTLE_MS, quest, useQuest, type DenyView, type Dir } from '../game/store.ts'
import { decide, type Identity } from '../game/ppl.ts'
import { sound, startSound, useSound, type SoundSettings } from '../game/sound.ts'
import { BOARD_TILES, MAP_HEIGHT, MAP_WIDTH, TILE_PX } from '../game/world.ts'
import { KINGDOM_DOMAIN, SIGNED_IN_MESSAGE, zoneById } from '../game/zones.ts'

/** Wide enough for the panels beside the game. The game fits the height, so width alone decides. */
const SIDE_BY_SIDE = '(min-width: 960px)'
const ANY_TOUCH = '(any-pointer: coarse)'

const STAGE_LABEL: Record<QuestStage, string> = {
  anonymous: 'Anonymous',
  citizen: 'Citizen',
  proven: 'Proven',
  knighted: 'Knighted (stale claims)',
  knight: 'Knight',
  armed: 'Armed knight',
}

const TOAST_TONE: Record<'allow' | 'deny' | 'info', string> = {
  allow: 'border-allow text-allow',
  deny: 'border-deny text-deny',
  info: 'border-lens',
}

const gutter = 'pl-[max(16px,env(safe-area-inset-left,0px))] pr-[max(16px,env(safe-area-inset-right,0px))]'

const codeBlock =
  'overflow-x-auto rounded border border-panel-edge bg-code-bg px-3 py-2.5 text-[0.8rem] leading-[1.45] text-lens'

const docLinks = 'mt-2.5 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-[0.85rem]'
const panel = 'min-w-0 rounded-md border border-panel-edge bg-panel px-3.5 py-3'

const panelTitle =
  'mb-2 flex justify-between gap-2 font-display text-base font-bold tracking-[0.04em] text-sun'

const panelMuted = 'font-body text-[0.85rem] text-muted'

const actionButton =
  'grid size-16 place-items-center rounded-full border-2 bg-panel font-display text-[1.3rem] leading-none text-ink'

const headerButton =
  'relative rounded border-2 border-panel-edge bg-panel px-3 py-1 font-display text-ink hover:border-lens'

const linkButton = 'mt-2.5 border-0 bg-transparent p-0 text-[0.8rem] text-muted underline'

const stageDescription = (stage: QuestStage) =>
  questMachine.getStateNodeById(`quest.${stage}`).description ?? ''

function useMedia(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query)
      list.addEventListener('change', onChange)

      return () => list.removeEventListener('change', onChange)
    },
    () => matchMedia(query).matches,
    () => false,
  )
}

const sideBySide = () => matchMedia(SIDE_BY_SIDE).matches

/** Touch controls show on any touch screen, until the player picks up a keyboard; a touch brings them back. */
function useTouchControls() {
  const touch = useMedia(ANY_TOUCH)
  const [usingKeys, setUsingKeys] = useState(false)

  useEffect(() => {
    const onKey = () => setUsingKeys(true)

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') setUsingKeys(false)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return touch && !usingKeys
}

/** Detects Pomerium, restores the player's identity, and handles the sign-in round trip. */
function useBoot() {
  useEffect(() => {
    const url = new URL(location.href)
    const returning = url.searchParams.has('signedin')

    if (returning) history.replaceState(null, '', url.pathname)
    void probe().then(({ mode, identity }) => {
      quest.setMode(mode, identity)

      if (identity.authenticated) quest.send({ type: 'SIGNED_IN', groups: identity.groups })
      else quest.send({ type: 'SIGNED_OUT' })

      if (returning) {
        quest.start()

        if (identity.authenticated) quest.toast(`Signed in as ${identity.email}`, 'allow')
      }
    })
  }, [])
}

function useDialogKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A handled key (like the Enter that starts the game) must not also advance a dialog.
      if (event.repeat) return

      const {
        celebrating,
        deny,
        dialog,
        finale,
        houseEditor,
        journalOpen,
        menuOpen,
        phished,
        signIn,
        visits,
      } = quest.get()

      // The celebration and phished screens, and the house's desk and visitors, handle their own keys.
      if (celebrating || phished || houseEditor || visits) return
      const journalKey = event.key === 'i' || event.key === 'I'
      const confirm = event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E'

      // A focused tab or button inside a tabbed screen handles its own Enter and Space.
      // (A button left focused in the hidden tab doesn't count.)
      const onButton =
        event.target instanceof HTMLButtonElement && !event.target.closest('[aria-hidden="true"]')

      if (signIn) {
        if (event.key === 'Escape') {
          event.preventDefault()
          quest.cancelSignIn()
        }
      } else if ((deny || (finale && !dialog)) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        window.dispatchEvent(new Event(TAB_EVENT))
      } else if (finale && !dialog) {
        if ((confirm && !onButton) || event.key === 'Escape') {
          event.preventDefault()
          quest.closeFinale()
        }
      } else if (deny && ((confirm && !onButton) || event.key === 'Escape')) {
        event.preventDefault()
        quest.closeDeny()
      } else if (dialog && confirm && !onButton) {
        event.preventDefault()
        quest.advance()
      } else if (journalOpen && (journalKey || event.key === 'Escape')) {
        event.preventDefault()
        quest.closeJournal()
      } else if (!dialog && !deny && !menuOpen && journalKey && !sideBySide()) {
        event.preventDefault()
        quest.openJournal()
      } else if (!dialog && !deny && event.key === 'Escape') {
        event.preventDefault()

        if (quest.get().menuOpen) quest.closeMenu()
        else quest.openMenu()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** In dev, a reload while playing (an edited game file) skips the title screen. */
const RESUME_KEY = 'pomerium-quest/dev/resume'

function useDevResume(started: boolean) {
  useEffect(() => {
    if (import.meta.env.DEV && sessionStorage.getItem(RESUME_KEY)) begin()
  }, [])

  useEffect(() => {
    if (!import.meta.env.DEV) return

    if (started) sessionStorage.setItem(RESUME_KEY, '1')
    else sessionStorage.removeItem(RESUME_KEY)
  }, [started])
}

export function Quest() {
  useBoot()
  useEffect(startSound, [])
  useDialogKeys()
  const started = useQuest((s) => s.started)
  useDevResume(started)

  return started ? <Kingdom /> : <Splash />
}

/** A save exists once a game has been started (progress saves as you play). */
const hasSave = () => quest.get().progress.playedBefore

const begin = () => {
  // Every gate is a request through Pomerium: without it there's no game to play.
  if (quest.get().mode !== 'pomerium') return
  const firstTime = !quest.get().progress.playedBefore

  quest.progress({ playedBefore: true })
  quest.start()

  // Open the intro after this keypress finishes, so the same Enter doesn't also advance it.
  if (firstTime) setTimeout(() => quest.say(INTRO), 0)
}

const menuButton =
  'w-full rounded border-2 border-panel-edge bg-panel px-4 py-2.5 text-left font-display text-[1.05rem] text-ink hover:border-lens focus-visible:border-lens'

function Splash() {
  const mode = useQuest((s) => s.mode)
  const saved = useQuest(hasSave)
  const [confirmingNew, setConfirmingNew] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      begin()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <main
      className={`splash-bg grid min-h-screen place-items-center content-center gap-3 py-8 text-center ${gutter}`}
    >
      <img
        className="h-auto w-[min(360px,78vw)] drop-shadow-[0_12px_40px_rgb(255_79_184/0.35)]"
        src={SHEETS.splash}
        alt="The Pomerium Pomeranian in aviators and a leather jacket"
      />
      <h1 className="sunset-text m-0 font-display text-[clamp(2.2rem,7vw,3.6rem)] font-bold tracking-[0.02em] text-balance">
        Pomerium Quest
      </h1>
      <p className="m-0 max-w-[36ch] text-muted">Every guard checks you, every time.</p>
      {mode !== 'unreachable' && (
        <>
          <button
            className="mt-2 motion-safe:animate-blink rounded border-3 border-night-deep bg-lime px-[22px] py-3 font-display text-[1.15rem] text-night-deep shadow-[4px_4px_0_var(--color-night-deep)]"
            type="button"
            onClick={begin}
            autoFocus
          >
            {saved ? 'Press Enter to continue' : 'Press Enter to start'}
          </button>
          {saved &&
            (confirmingNew ? (
              <p className="m-0 text-[0.9rem]">
                Start a new game? Your lessons and progress are cleared.{' '}
                <button className={linkButton} type="button" onClick={playAgain}>
                  Yes, start over
                </button>{' '}
                <button className={linkButton} type="button" onClick={() => setConfirmingNew(false)}>
                  Keep my save
                </button>
              </p>
            ) : (
              <button className={linkButton} type="button" onClick={() => setConfirmingNew(true)}>
                New game
              </button>
            ))}
        </>
      )}
      <SplashSound />
      <p className="m-0 text-[0.85rem] text-muted">
        {mode === 'loading' && 'Looking for Pomerium…'}
        {mode === 'pomerium' && 'Connected to a real Pomerium. Every guard enforces a live route.'}
        {mode === 'unreachable' &&
          "No Pomerium in front of this game, so there's nothing to play. Run ./quest dev and open the URL it prints."}
      </p>
    </main>
  )
}

/** The browser may hold the title music back until a click, so offer one; then the two switches. */
function SplashSound() {
  const { blocked, music, effects } = useSound()

  if (blocked && music)
    return (
      <button className={linkButton} type="button" onClick={() => sound.unlock()}>
        ♪ Play music
      </button>
    )

  return (
    <p className="m-0 flex gap-3.5 text-[0.85rem]">
      <button className={linkButton} type="button" aria-pressed={music} onClick={() => sound.toggle('music')}>
        Music: {music ? 'on' : 'off'}
      </button>
      <button
        className={linkButton}
        type="button"
        aria-pressed={effects}
        onClick={() => sound.toggle('effects')}
      >
        Sound effects: {effects ? 'on' : 'off'}
      </button>
    </p>
  )
}

/** The fewest tiles the board shows across or down, however narrow the window. */
const MIN_BOARD_TILES = 9

/** The frame around the board, in CSS pixels: its border-4. */
const BOARD_BORDER = 4

interface Board {
  /** The board's size on the page, in CSS pixels. */
  readonly width: number
  readonly height: number
  /** How much of the world it shows, in game pixels. */
  readonly view: { readonly width: number; readonly height: number }
}

/**
 * Sizes the board to the space it's given: it fills it, at a tile size that shows about 16 by 12
 * tiles' worth of map whatever the window's shape, and never more than the whole map.
 */
function useBoard() {
  const slot = useRef<HTMLDivElement>(null)
  const [board, setBoard] = useState<Board | null>(null)

  useEffect(() => {
    const element = slot.current

    if (!element) return

    const measure = () => {
      const space = element.getBoundingClientRect()
      const width = space.width - 2 * BOARD_BORDER
      const height = space.height - 2 * BOARD_BORDER
      // Tiles are the same size whatever the window's shape: the board shows about 16 by 12 tiles' worth
      // of map, more across in a wide window and more down in a tall one, but never fewer than a few.
      const area = Math.sqrt((width * height) / (BOARD_TILES.cols * BOARD_TILES.rows)) / TILE_PX
      const fewest = Math.min(width, height) / (MIN_BOARD_TILES * TILE_PX)
      const scale = Math.min(area, fewest)

      if (scale <= 0) return
      const fitWidth = Math.floor(Math.min(width, MAP_WIDTH * TILE_PX * scale))
      const fitHeight = Math.floor(Math.min(height, MAP_HEIGHT * TILE_PX * scale))

      setBoard({
        width: fitWidth + 2 * BOARD_BORDER,
        height: fitHeight + 2 * BOARD_BORDER,
        view: { width: Math.round(fitWidth / scale), height: Math.round(fitHeight / scale) },
      })
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return { slot, board }
}

function Kingdom() {
  const wide = useMedia(SIDE_BY_SIDE)
  const touch = useTouchControls()
  const { slot, board } = useBoard()

  useEffect(() => {
    if (wide) quest.closeJournal()
  }, [wide])

  return (
    <div className={`kingdom pt-[18px] pb-4 ${gutter}`} data-touch={touch || undefined}>
      <header className="mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="m-0 font-display text-[1.7rem] leading-tight font-bold text-sun max-sm:text-[1.3rem]">
          Pomerium Quest
        </h1>
        <p className="m-0 text-xs tracking-[0.04em] text-muted uppercase max-sm:hidden">
          Chapter one · Identity and access
        </p>
        <div className="ml-auto flex gap-2">
          {!wide && <JournalButton />}
          <button className={headerButton} type="button" onClick={() => quest.openMenu()}>
            Menu {!touch && <span className="text-muted">(Esc)</span>}
          </button>
        </div>
      </header>
      <div className="kingdom-layout">
        <section className="play" aria-label="Game" onContextMenu={(event) => event.preventDefault()}>
          <div className="[grid-area:hud]">
            <Hud />
          </div>
          <div className="grid min-h-0 min-w-0 place-items-center [grid-area:game]" ref={slot}>
            <div
              className="relative overflow-hidden rounded-md border-4 border-night-deep bg-night-deep shadow-[0_0_0_2px_var(--color-panel-edge),0_18px_50px_rgb(0_0_0/0.45)]"
              style={board ? { width: board.width, height: board.height } : { visibility: 'hidden' }}
            >
              <GameCanvas view={board?.view} />
              <Toast />
              <DialogBox />
              <DenyScreen />
              <HouseEditor />
              <VisitsScreen />
              <PauseMenu />
            </div>
          </div>
          {touch ? (
            <TouchControls />
          ) : (
            <p className="m-0 text-[0.85rem] text-muted [grid-area:hint]">
              Move: arrow keys or W A S D · Talk and read: E or Enter · Sword: Space or J · Menu: Esc
              {!wide && ' · Journal: I'}
            </p>
          )}
        </section>
        <Journal drawer={!wide} />
      </div>
      <SignInSheet />
      <Finale />
      <Celebration />
      <Phished />
    </div>
  )
}

function JournalButton() {
  const unread = useQuest((s) => s.journalUnread)

  return (
    <button id="journal-button" className={headerButton} type="button" onClick={() => quest.openJournal()}>
      Journal
      {unread && (
        <span
          className="absolute -top-1 -right-1 size-2.5 rounded-full bg-neon shadow-[0_0_0_2px_var(--color-night)]"
          aria-label="new entries"
        />
      )}
    </button>
  )
}

/** The panels: beside the game when there is room, otherwise in a drawer that pauses the game. */
function Journal({ drawer }: { readonly drawer: boolean }) {
  const open = useQuest((s) => s.journalOpen)

  const panels = (
    <>
      <IdentityPanel />
      <GearPanel />
      <AccessLog />
      <Lessons />
    </>
  )

  if (!drawer)
    return (
      <aside className="grid min-h-0 min-w-0 content-start gap-3.5 overflow-y-auto overscroll-contain">
        {panels}
      </aside>
    )

  return open ? <JournalDrawer>{panels}</JournalDrawer> : null
}

function JournalDrawer({ children }: { readonly children: ReactNode }) {
  const drawer = useRef<HTMLElement>(null)

  // Hand focus back to the button that opened the drawer.
  useEffect(() => () => document.getElementById('journal-button')?.focus(), [])

  const trapFocus = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab' || !drawer.current) return
    const focusable = drawer.current.querySelectorAll<HTMLElement>('button, a[href]')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-night-deep/70"
        aria-hidden="true"
        onClick={() => quest.closeJournal()}
      />
      <aside
        ref={drawer}
        className="journal-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-title"
        onKeyDown={trapFocus}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="journal-title" className="m-0 font-display text-[1.4rem] text-sun">
            Journal
          </h2>
          <button className={headerButton} type="button" onClick={() => quest.closeJournal()} autoFocus>
            Close
          </button>
        </div>
        {children}
      </aside>
    </>
  )
}

/** The Oracle's sign-in page, framed over the game: a modal on wide screens, a bottom sheet on phones. */
function SignInSheet() {
  const signIn = useQuest((s) => s.signIn)
  const frame = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!signIn) return
    setLoaded(false)

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return

      if (event.data === SIGNED_IN_MESSAGE) quest.finishSignIn()
    }

    window.addEventListener('message', onMessage)

    return () => window.removeEventListener('message', onMessage)
  }, [signIn])

  if (!signIn) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-night-deep/70"
        aria-hidden="true"
        onClick={() => quest.cancelSignIn()}
      />
      <section className="sign-in-sheet" role="dialog" aria-modal="true" aria-labelledby="sign-in-title">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <h2 id="sign-in-title" className="m-0 font-display text-[1.2rem] text-sun">
            Sign in with the Oracle
          </h2>
          <button className={headerButton} type="button" onClick={() => quest.cancelSignIn()}>
            Close
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {!loaded && (
            <p className="absolute inset-0 m-0 grid place-items-center text-muted" role="status">
              Pomerium is sending you to the Oracle…
            </p>
          )}
          <iframe
            ref={frame}
            className="size-full border-0"
            src={signIn.url}
            title="The Oracle, your identity provider"
            onLoad={() => setLoaded(true)}
          />
        </div>
        <p className="m-0 px-4 py-2 text-[0.8rem] text-muted">
          Signing in through Pomerium, without leaving the game.{' '}
          <a href={signIn.url}>Open it full page instead</a>
        </p>
      </section>
    </>
  )
}

function PauseMenu() {
  const open = useQuest((s) => s.menuOpen)
  const savedAt = useQuest((s) => s.savedAt)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  if (!open) return null

  return (
    <div
      className="absolute inset-0 grid place-items-center bg-night-deep/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="menu-title"
    >
      <div className="grid w-[min(320px,100%)] gap-2.5 rounded-md border-2 border-ink bg-night-deep p-5">
        <h2 id="menu-title" className="m-0 font-display text-[1.4rem] text-sun">
          Paused
        </h2>
        <button className={menuButton} type="button" onClick={() => quest.closeMenu()} autoFocus>
          Resume
        </button>
        {!sideBySide() && (
          <button className={menuButton} type="button" onClick={() => quest.openJournal()}>
            Journal
          </button>
        )}
        <button className={menuButton} type="button" onClick={() => quest.save()}>
          Save game
        </button>
        <SoundToggle setting="music" label="Music" />
        <SoundToggle setting="effects" label="Sound effects" />
        {confirmingRestart ? (
          <div className="grid gap-2 rounded border-2 border-deny p-3 text-[0.9rem]">
            <span>Restart from the village? Your lessons and progress are cleared.</span>
            <div className="flex gap-2">
              <button className={menuButton} type="button" onClick={playAgain}>
                Restart
              </button>
              <button className={menuButton} type="button" onClick={() => setConfirmingRestart(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className={menuButton} type="button" onClick={() => setConfirmingRestart(true)}>
            Restart
          </button>
        )}
        <button className={menuButton} type="button" onClick={() => quest.quit()}>
          Quit to title
        </button>
        <p className="m-0 text-[0.8rem] text-muted">
          Progress saves automatically as you play{savedAt ? `; last saved at ${savedAt}` : ''}. Your sign-in
          stays with Pomerium.
        </p>
      </div>
    </div>
  )
}

function SoundToggle({ setting, label }: { readonly setting: keyof SoundSettings; readonly label: string }) {
  const on = useSound()[setting]

  return (
    <button
      className={`${menuButton} flex justify-between`}
      type="button"
      aria-pressed={on}
      onClick={() => sound.toggle(setting)}
    >
      {label}
      <span className={on ? 'text-allow' : 'text-muted'}>{on ? 'On' : 'Off'}</span>
    </button>
  )
}

function GameCanvas({ view }: { readonly view: Board['view'] | undefined }) {
  const host = useRef<HTMLDivElement>(null)
  const [game, setGame] = useState<import('phaser').Game | null>(null)

  useEffect(() => {
    let destroyed = false
    let destroy = () => {}

    void import('../game/scene.ts').then(({ startGame }) => {
      if (destroyed || !host.current) return
      const started = startGame(host.current)
      setGame(started)
      destroy = () => started.destroy(true)
    })

    return () => {
      destroyed = true
      destroy()
    }
  }, [])

  // The board changed size: show that much of the world.
  useEffect(() => {
    if (!game || !view) return
    void import('../game/scene.ts').then(({ resizeGame }) => resizeGame(game, view))
  }, [game, view])

  // Tapping the scene above an open dialog advances it, as A does.
  return <div className="pixelated" ref={host} onClick={() => quest.get().dialog && quest.advance()} />
}

function Hud() {
  const hp = useQuest((s) => s.hp)
  const region = useQuest((s) => s.region)
  const defeated = useQuest((s) => s.defeated)

  return (
    <div className="flex items-center justify-between gap-3 font-display text-[1.05rem]">
      <span aria-label={`${hp / 2} of ${MAX_HP / 2} hearts`}>
        {Array.from({ length: MAX_HP / 2 }, (_, i) => {
          const fill = Math.min(Math.max(hp - i * 2, 0), 2)

          return (
            <span key={i} className="relative mr-0.5 inline-block text-heart-empty">
              ♥
              {fill > 0 && (
                <span
                  className={`absolute inset-0 text-deny ${fill === 1 ? '[clip-path:inset(0_50%_0_0)]' : ''}`}
                  aria-hidden="true"
                >
                  ♥
                </span>
              )}
            </span>
          )
        })}
      </span>
      <span className="text-sun">{region}</span>
      <span className="text-muted tabular-nums">Bots {defeated.bot}</span>
    </div>
  )
}

function Toast() {
  const toast = useQuest((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => quest.clearToast(toast.id), 2600)

    return () => clearTimeout(timer)
  }, [toast])

  if (!toast) return null

  return (
    <div
      className={`pointer-events-none absolute top-2.5 left-1/2 max-w-[calc(100%-24px)] -translate-x-1/2 rounded border-2 bg-night-deep/92 px-3 py-1.5 font-mono text-[0.8rem] ${TOAST_TONE[toast.tone]}`}
      role="status"
    >
      {toast.text}
    </div>
  )
}

function DialogBox() {
  const dialog = useQuest((s) => s.dialog)

  if (!dialog) return null
  const page = dialog.pages[dialog.index]

  if (!page) return null
  const last = dialog.index === dialog.pages.length - 1
  const { choices } = page

  return (
    <div
      className={`absolute right-2.5 bottom-2.5 left-2.5 max-h-[calc(100%-20px)] overflow-auto rounded-md border-3 border-ink bg-night-deep/96 px-4 py-3 shadow-[0_0_0_3px_var(--color-night-deep)] ${choices ? '' : 'cursor-pointer'}`}
      role="dialog"
      aria-live="polite"
      onClick={() => quest.advance()}
    >
      <p className="mb-1 font-display tracking-[0.03em] text-sun">{page.who}</p>
      <p className="m-0 max-w-[68ch] text-[clamp(0.9rem,1.6vw,1.02rem)]">{page.text}</p>
      {page.code && <pre className={`mt-2.5 ${codeBlock}`}>{page.code}</pre>}
      {page.links && page.links.length > 0 && (
        <ul className={docLinks}>
          {page.links.map((doc) => (
            <li key={doc.href + doc.label}>
              <a
                href={doc.href}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Docs: {doc.label} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
      {choices ? (
        <Choices choices={choices} />
      ) : (
        <p className="mt-2 text-right font-display text-[0.85rem] text-muted">
          {last ? 'Enter or tap to close' : 'Enter or tap to continue ▾'}
        </p>
      )}
    </div>
  )
}

/** A dialog's answers as buttons; arrow keys move between them. */
function Choices({ choices }: { readonly choices: readonly Choice[] }) {
  const [shownAt] = useState(() => performance.now())

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // A held Enter must not pick an answer the moment the choice appears.
    if (event.repeat) {
      event.preventDefault()

      return
    }

    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]

    if (!step) return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll('button')]
    const at = buttons.findIndex((button) => button === document.activeElement)
    buttons[(at + step + buttons.length) % buttons.length]?.focus()
  }

  return (
    <div className="mt-3 flex flex-wrap justify-end gap-2" role="group" onKeyDown={onKeyDown}>
      {choices.map((choice, i) => (
        <button
          key={choice.label}
          className="rounded border-2 border-panel-edge bg-panel px-3.5 py-2 font-display text-ink hover:border-lens focus-visible:border-lens"
          type="button"
          autoFocus={i === 0}
          onClick={(event) => {
            event.stopPropagation()

            // The Enter that turned to this page lands on the focused answer too: ignore it.
            if (performance.now() - shownAt > SETTLE_MS) quest.choose(choice)
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  )
}

const groupsList = (groups: readonly string[]) => `groups: [${groups.join(', ')}]`

/** Where the claims in a stale decision came from: the new session, and the user record Pomerium cached. */
function CachedClaims({ claims }: { readonly claims: NonNullable<DenyView['cachedClaims']> }) {
  const rows = [
    { source: 'Session (you just signed in)', groups: groupsList(claims.session), wins: false },
    {
      source: 'User record (cached up to 1 min)',
      groups: claims.cached ? groupsList(claims.cached) : 'groups from before you signed in again',
      wins: true,
    },
  ]

  return (
    <div className="mb-2.5 overflow-x-auto rounded bg-paper-tint px-2.5 py-2">
      <p className="mb-1 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase">
        Claims Pomerium merged
      </p>
      {rows.map((row) => (
        <div
          key={row.source}
          className="grid grid-cols-[minmax(12em,max-content)_1fr] items-baseline gap-2 text-[0.8rem]"
        >
          <span className="text-paper-muted">{row.source}</span>
          <code className={row.wins ? 'font-bold' : 'line-through'}>{row.groups}</code>
        </div>
      ))}
      <p className="mt-1 mb-0 text-[0.75rem] text-paper-muted">
        The user record wins, so the policy below sees the old groups.
      </p>
      <p className="mt-2.5 mb-1 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase">
        Why signing in again didn't fix it yet
      </p>
      <ol className="m-0 grid list-decimal gap-1 pl-5 text-[0.8rem]">
        <li>
          Pomerium keeps two records: a <strong>session</strong> per sign-in, and one{' '}
          <strong>user record</strong> per person that every session shares. Each holds claims.
        </li>
        <li>Signing out deleted your old session. Your user record stayed.</li>
        <li>
          Signing in made a new session with your new groups, and updated your user record with them too.
        </li>
        <li>
          But this guard read your user record from Pomerium's cache: a copy saved on an earlier request, kept
          for up to a minute. Your session is new, so it was read fresh. Your user record wasn't.
        </li>
        <li>
          The <code>claim</code> check merges the session's claims with the user record's, and the user record
          wins. So the old copy decides until it expires.
        </li>
      </ol>
    </div>
  )
}

const enterKeep =
  'motion-safe:animate-blink rounded border-3 border-night-deep bg-lime px-[18px] py-2.5 font-display text-[1.05rem] text-night-deep shadow-[4px_4px_0_var(--color-night-deep)]'

/** The Royal Keep's doors open: the quest is done. */
function Finale() {
  const open = useQuest((s) => s.finale)
  const identity = useQuest((s) => s.identity)

  if (!open) return null

  return (
    <TabbedScreen
      name="finale"
      label="How you got in"
      showing={open}
      overlay="fixed inset-0 z-50 grid place-items-center bg-[rgb(10_7_22/0.88)] p-4"
      kingdom={<FinaleStory email={identity.email} />}
      pomerium={<FinalePomerium identity={identity} />}
    />
  )
}

const VOUCHED_BY: readonly { readonly role: string; readonly by: string }[] = [
  { role: `A citizen of ${KINGDOM_DOMAIN}`, by: 'the Oracle knows who you are' },
  { role: 'A knight', by: 'the Captain vouched for you' },
  { role: 'A scholar', by: 'the Librarian vouched for you' },
]

function FinaleStory({ email }: { readonly email: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-tr-lg rounded-b-lg border-3 border-sun bg-night-deep px-5 py-[18px]">
      <h2 id="finale-title-kingdom" className="sunset-text m-0 font-display text-[2rem] leading-tight">
        Quest complete
      </h2>
      <p className="m-0">
        The Royal Keep opens its doors to {email}. The guard admits only someone who is all three, and you
        are:
      </p>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {VOUCHED_BY.map(({ role, by }) => (
          <li key={role} className="flex items-baseline gap-2">
            <span className="text-allow">✓</span>
            <span>
              <strong className="font-display text-sun">{role}</strong>{' '}
              <span className="text-muted">· {by}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[0.85rem] text-muted">
        Every gate in the kingdom is a Pomerium route, and its guard's orders are the route's policy. See how
        Pomerium let you in on the{' '}
        <button className="border-0 bg-transparent p-0 text-lens underline" type="button" onClick={switchTab}>
          In Pomerium
        </button>{' '}
        tab.
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <button className={enterKeep} type="button" onClick={() => quest.closeFinale()} autoFocus>
          Enter the Keep ▸
        </button>
        <p className={`${tabHint} text-muted`}>← → switch tabs · Enter to go in</p>
      </div>
    </div>
  )
}

function FinalePomerium({ identity }: { readonly identity: Identity }) {
  const learned = useQuest((s) => s.progress.lessons)
  const keep = zoneById('keep')
  const path = `${keep.prefix}/enter`
  const lines = decide(keep, identity, { method: 'GET', path }).lines

  return (
    <div className="flex flex-col rounded-tr-lg rounded-b-lg border-t-6 border-allow bg-paper px-5 py-[18px] text-paper-ink [&_a]:text-paper-link">
      <p className="m-0 font-mono text-[2.2rem] leading-none font-bold text-[#15803d]">200</p>
      <h2 className="mt-0.5 mb-2 text-[1.25rem] font-bold" id="finale-title-pomerium">
        Access allowed
      </h2>
      <p className="m-0 text-[0.85rem] wrap-anywhere">
        <code>
          GET {location.origin}
          {path}
        </code>
      </p>
      <p className="mt-0.5 mb-2.5 text-[0.85rem] text-paper-muted">as {identity.email}</p>
      <PolicyLines lines={lines} />
      <p className="mt-3 mb-0">
        One allow rule, three criteria under and. Each matched a claim in your session, so Pomerium forwarded
        the request to the app behind the route. Every guard you passed worked the same way.
      </p>
      <p className="mt-3 mb-1 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase">
        Lessons learned · {LESSON_ORDER.filter((id) => learned.includes(id)).length} of {LESSON_ORDER.length}
      </p>
      <ol className="m-0 grid list-decimal gap-x-6 gap-y-[3px] pl-[1.4em] text-[0.82rem] sm:grid-cols-2">
        {LESSON_ORDER.map((id) =>
          learned.includes(id) ? (
            <li key={id}>
              <a href={LESSONS[id].link.href} target="_blank" rel="noreferrer">
                {LESSONS[id].title} ↗
              </a>
            </li>
          ) : (
            <li key={id} className="text-paper-muted">
              Not learned yet
            </li>
          ),
        )}
      </ol>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3.5">
        <button className={enterKeep} type="button" onClick={() => quest.closeFinale()}>
          Enter the Keep ▸
        </button>
        <p className={`${tabHint} text-paper-muted`}>← → switch tabs · Enter to go in</p>
      </div>
    </div>
  )
}

/**
 * A refusal, told twice. The first tab is the game: who turned you away and why, in the kingdom's
 * words. The second is the same decision as Pomerium made it: the request, the policy, the rule
 * that failed.
 */
function DenyScreen() {
  const deny = useQuest((s) => s.deny)

  if (!deny) return null

  return (
    <TabbedScreen
      name="deny"
      label="Why the guard refused"
      showing={deny}
      overlay="absolute inset-0 grid items-start justify-items-center overflow-auto bg-[rgb(10_7_22/0.88)] p-3.5"
      kingdom={<DenyStory deny={deny} />}
      pomerium={<DenyPomerium deny={deny} />}
    />
  )
}

function DenyStory({ deny }: { readonly deny: DenyView }) {
  return (
    <div className="flex flex-col rounded-tr-lg rounded-b-lg border-3 border-ink bg-night-deep px-5 py-[18px]">
      <h2 className="m-0 font-display text-[1.6rem] leading-tight text-deny" id="deny-title-kingdom">
        {deny.story.title}
      </h2>
      <p className="mt-2 mb-0 max-w-[60ch] text-[clamp(0.95rem,1.6vw,1.05rem)]">{deny.story.text}</p>
      <p className="mt-3 mb-0 text-[0.85rem] text-muted">
        Every gate in the kingdom is a Pomerium route, and its guard's orders are the route's policy. See how
        Pomerium made this call in the{' '}
        <button className="border-0 bg-transparent p-0 text-lens underline" type="button" onClick={switchTab}>
          In Pomerium
        </button>{' '}
        tab.
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3.5">
        <button
          className="rounded border-2 border-ink bg-panel px-3.5 py-2 font-display text-ink hover:border-lens"
          type="button"
          onClick={() => quest.closeDeny()}
        >
          Back to the kingdom
        </button>
        <p className={`${tabHint} text-muted`}>← → switch tabs · Enter to close</p>
      </div>
    </div>
  )
}

function DenyPomerium({ deny }: { readonly deny: DenyView }) {
  return (
    <div className="flex flex-col rounded-tr-lg rounded-b-lg border-t-6 border-deny bg-paper px-5 py-[18px] text-paper-ink [&_a]:text-paper-link">
      {deny.onBehalfOf && (
        <p className="mb-2 rounded bg-paper-tint px-2.5 py-1.5 text-[0.8rem] text-paper-muted">
          Not your request: this is what {deny.onBehalfOf} was told by the guard.
        </p>
      )}
      <p className="m-0 font-mono text-[2.2rem] leading-none font-bold text-deny">{deny.status}</p>
      <h2 className="mt-0.5 mb-2 text-[1.25rem] font-bold" id="deny-title-pomerium">
        {deny.title}
      </h2>
      <p className="m-0 text-[0.85rem] wrap-anywhere">
        <code>{deny.requestLine}</code>
      </p>
      <p className="mt-0.5 mb-2.5 text-[0.85rem] text-paper-muted">as {deny.who}</p>
      {deny.cachedClaims && <CachedClaims claims={deny.cachedClaims} />}
      {deny.lines.length > 0 && <PolicyLines lines={deny.lines} />}
      <p className="mt-3">{deny.hint}</p>
      {deny.requestId && (
        <p className="mt-2.5 text-[0.75rem] text-paper-muted wrap-anywhere">
          Pomerium request ID <code>{deny.requestId}</code>
        </p>
      )}
      <ul className={docLinks}>
        {deny.links.map((doc) => (
          <li key={doc.href + doc.label}>
            <a href={doc.href} target="_blank" rel="noreferrer">
              Docs: {doc.label} ↗
            </a>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3.5">
        <button
          className="rounded bg-paper-ink px-3.5 py-2 text-paper"
          type="button"
          onClick={() => quest.closeDeny()}
        >
          Back to the kingdom
        </button>
        <p className={`${tabHint} text-paper-muted`}>← → switch tabs · Enter to close</p>
      </div>
    </div>
  )
}

/** A touch on A or B first dismisses a deny screen or advances a dialog. */
const tap = (action: () => void) => () => {
  const { deny, dialog } = quest.get()

  if (deny) quest.closeDeny()
  else if (dialog) quest.advance()
  else action()
}

function TouchControls() {
  return (
    <>
      <DPad />
      <div
        className="flex items-center justify-end gap-3.5 self-center [grid-area:actions]"
        aria-label="Actions"
      >
        <button
          type="button"
          className={`${actionButton} border-neon`}
          onPointerDown={tap(() => quest.press('attack'))}
        >
          B<small className="font-body text-[0.6rem]">Sword</small>
        </button>
        <button
          type="button"
          className={`${actionButton} border-lime`}
          onPointerDown={tap(() => quest.press('interact'))}
        >
          A<small className="font-body text-[0.6rem]">Talk</small>
        </button>
      </div>
    </>
  )
}

const ARROWS: Record<Dir, { readonly glyph: string; readonly place: string }> = {
  up: { glyph: '▲', place: 'top-1.5 left-1/2 -translate-x-1/2' },
  down: { glyph: '▼', place: 'bottom-1.5 left-1/2 -translate-x-1/2' },
  left: { glyph: '◀', place: 'top-1/2 left-2 -translate-y-1/2' },
  right: { glyph: '▶', place: 'top-1/2 right-2 -translate-y-1/2' },
}

/**
 * One round pad rather than four buttons, so a thumb can slide from one direction to the next.
 * The direction is the touch's angle from the center, in four 90° sectors; the middle means stop.
 */
function DPad() {
  const [active, setActive] = useState<Dir | null>(null)
  const held = useRef<Dir | null>(null)

  const hold = (dir: Dir | null) => {
    if (dir === held.current) return
    held.current = dir
    setActive(dir)
    quest.hold(dir)
  }

  const steer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - (box.left + box.width / 2)
    const dy = event.clientY - (box.top + box.height / 2)

    if (Math.hypot(dx, dy) < box.width * 0.1) hold(null)
    else if (Math.abs(dx) > Math.abs(dy)) hold(dx > 0 ? 'right' : 'left')
    else hold(dy > 0 ? 'down' : 'up')
  }

  return (
    <div
      className="relative size-[156px] touch-none self-center rounded-full border-2 border-panel-edge bg-panel [grid-area:dpad]"
      role="group"
      aria-label="Direction pad"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        steer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) steer(event)
      }}
      onPointerUp={() => hold(null)}
      onPointerCancel={() => hold(null)}
      onLostPointerCapture={() => hold(null)}
    >
      {Object.entries(ARROWS).map(([dir, { glyph, place }]) => (
        <span
          key={dir}
          className={`pointer-events-none absolute grid size-11 place-items-center rounded-lg text-[1.1rem] ${place} ${active === dir ? 'bg-lens text-night-deep' : 'text-muted'}`}
        >
          {glyph}
        </span>
      ))}
    </div>
  )
}

function IdentityPanel() {
  const identity = useQuest((s) => s.identity)
  const stage = useQuest((s) => s.stage)

  const claims = identity.authenticated
    ? JSON.stringify({ email: identity.email, groups: identity.groups }, null, 2)
    : null

  return (
    <section className={panel}>
      <h2 className={panelTitle}>Your identity</h2>
      {claims ? (
        <pre className={`mt-1 ${codeBlock}`}>{claims}</pre>
      ) : (
        <p className={`my-[15px] ${panelMuted}`}>No session. Visit the Oracle to sign in.</p>
      )}
      <p className="mt-2.5 grid gap-0.5">
        <span className="font-semibold">{STAGE_LABEL[stage]}</span>
        <span className={panelMuted}>{stageDescription(stage)}</span>
      </p>
    </section>
  )
}

function GearPanel() {
  const stage = useQuest((s) => s.stage)
  const defeated = useQuest((s) => s.defeated)
  const steel = stage === 'armed'

  return (
    <section className={panel}>
      <h2 className={panelTitle}>Gear</h2>
      <ul className="m-0 grid list-none gap-1 p-0 [&>li]:flex [&>li]:justify-between [&>li]:gap-2">
        <li>
          <span>{steel ? 'Steel sword' : 'Wooden sword'}</span>
          <span className={panelMuted}>{steel ? 'breaks rock' : 'starter'}</span>
        </li>
        <li>
          <span>Wooden shield</span>
          <span className={panelMuted}>starter</span>
        </li>
        <li>
          <span>Bot slimes defeated</span>
          <span className="tabular-nums">
            {defeated.bot}
            {defeated.bot < KNIGHT_QUOTA && ` / ${KNIGHT_QUOTA}`}
          </span>
        </li>
      </ul>
    </section>
  )
}

function AccessLog() {
  const log = useQuest((s) => s.log)

  return (
    <section className={panel}>
      <h2 className={panelTitle}>Access log</h2>
      {log.length === 0 ? (
        <p className={panelMuted}>Every request a guard checks shows up here.</p>
      ) : (
        <ol className="m-0 grid max-h-60 list-none gap-1.5 overflow-auto p-0 text-[0.8rem]">
          {log.map((entry) => (
            <li
              key={entry.id}
              className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5"
            >
              <span className="font-mono text-muted tabular-nums">{entry.at}</span>
              <span
                className={`rounded-[3px] px-1.5 font-mono text-[0.7rem] font-semibold ${entry.decision === 'ALLOW' ? 'bg-allow/15 text-allow' : 'bg-deny/15 text-deny'}`}
              >
                {entry.decision}
              </span>
              <code className="wrap-anywhere">
                {entry.method} {entry.path}
              </code>
              <span className="col-[2/-1] text-muted wrap-anywhere">{entry.who}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Lessons() {
  const learned = useQuest((s) => s.progress.lessons)

  return (
    <section className={panel}>
      <h2 className={panelTitle}>
        Lessons{' '}
        <span className={panelMuted}>
          {/* A save from before a lesson was retired can still list it; count only current lessons. */}
          {LESSON_ORDER.filter((id) => learned.includes(id)).length} of {LESSON_ORDER.length}
        </span>
      </h2>
      <ol className="m-0 grid list-decimal gap-[3px] pl-[1.4em] text-[0.88rem]">
        {LESSON_ORDER.map((id) =>
          learned.includes(id) ? (
            <li key={id}>
              <a href={LESSONS[id].link.href} target="_blank" rel="noreferrer">
                {LESSONS[id].title} ↗
              </a>
            </li>
          ) : (
            <li key={id} className="text-locked">
              Not learned yet
            </li>
          ),
        )}
      </ol>
    </section>
  )
}
