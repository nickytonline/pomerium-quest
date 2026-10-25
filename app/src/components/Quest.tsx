import { useEffect, useRef, useState } from 'react'
import { probe } from '../game/access.ts'
import { INTRO, LESSONS, LESSON_ORDER } from '../game/content.ts'
import { KNIGHT_XP, questMachine, type QuestStage } from '../game/quest-machine.ts'
import { MAX_HP, quest, useQuest, type Dir, type Mode } from '../game/store.ts'

const MODE_LABEL: Record<Mode, string> = {
  loading: 'Detecting…',
  pomerium: 'Live Pomerium',
  simulated: 'Simulated',
}

const STAGE_LABEL: Record<QuestStage, string> = {
  anonymous: 'Anonymous',
  citizen: 'Citizen',
  proven: 'Proven',
  knighted: 'Knighted (stale claims)',
  knight: 'Knight',
  armed: 'Armed knight',
}

const MODE_CHIP: Record<Mode, string> = {
  loading: 'text-muted',
  pomerium: 'text-lime',
  simulated: 'text-lens',
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
const padButton = 'rounded-lg border-2 border-panel-edge bg-panel text-ink'

const actionButton =
  'grid size-16 place-items-center rounded-full border-2 bg-panel font-display text-[1.3rem] leading-none text-ink'

const linkButton = 'mt-2.5 border-0 bg-transparent p-0 text-[0.8rem] text-muted underline'

const stageDescription = (stage: QuestStage) =>
  questMachine.getStateNodeById(`quest.${stage}`).description ?? ''

/** Detects Pomerium, restores the player's identity, and handles the sign-in round trip. */
function useBoot() {
  useEffect(() => {
    const url = new URL(location.href)
    const returning = url.searchParams.has('signedin')

    if (returning) history.replaceState(null, '', url.pathname)
    void probe(quest.get().progress).then(({ mode, identity }) => {
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
      const { deny, dialog } = quest.get()
      const confirm = event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E'

      if (deny && (confirm || event.key === 'Escape')) {
        event.preventDefault()
        quest.closeDeny()
      } else if (dialog && confirm) {
        event.preventDefault()
        quest.advance()
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

export function Quest() {
  useBoot()
  useDialogKeys()
  const started = useQuest((s) => s.started)

  return started ? <Kingdom /> : <Splash />
}

/** A save exists once a game has been started (progress saves as you play). */
const hasSave = () => quest.get().progress.playedBefore

const begin = () => {
  const firstTime = !quest.get().progress.playedBefore

  quest.progress({ playedBefore: true })
  quest.start()

  // Open the intro after this keypress finishes, so the same Enter doesn't also advance it.
  if (firstTime) setTimeout(() => quest.say(INTRO), 0)
}

/** Clears progress and starts from the village. Your sign-in (and its claims) is kept. */
const newGame = () => {
  quest.resetProgress()
  const { identity } = quest.get()

  if (identity.authenticated) quest.send({ type: 'SIGNED_IN', groups: identity.groups })
  begin()
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
        src="/assets/splash.png"
        alt="The Pomerium Pomeranian in aviators and a leather jacket"
      />
      <h1 className="sunset-text m-0 font-display text-[clamp(2.2rem,7vw,3.6rem)] font-bold tracking-[0.02em] text-balance">
        Pomerium Quest
      </h1>
      <p className="m-0 max-w-[36ch] text-muted">
        Every gate has a guard. Every guard checks you, every time.
      </p>
      <button
        className="mt-2 animate-blink rounded border-3 border-night-deep bg-lime px-[22px] py-3 font-display text-[1.15rem] text-night-deep shadow-[4px_4px_0_var(--color-night-deep)]"
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
            <button className={linkButton} type="button" onClick={newGame}>
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
      <p className="m-0 text-[0.85rem] text-muted">
        {mode === 'loading' && 'Looking for Pomerium…'}
        {mode === 'pomerium' && 'Connected to a real Pomerium. Every gate is a live route.'}
        {mode === 'simulated' && 'Simulated mode: no Pomerium detected, so policies run in your browser.'}
      </p>
    </main>
  )
}

function Kingdom() {
  return (
    <div className={`mx-auto max-w-[1240px] pt-[18px] pb-10 ${gutter}`}>
      <header className="mb-3.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="m-0 font-display text-[1.7rem] font-bold text-sun">Pomerium Quest</h1>
        <p className="m-0 text-xs tracking-[0.04em] text-muted uppercase">
          Chapter one · Identity and access
        </p>
        <button
          className="ml-auto rounded border-2 border-panel-edge bg-panel px-3 py-1 font-display text-ink hover:border-lens"
          type="button"
          onClick={() => quest.openMenu()}
        >
          Menu <span className="text-muted">(Esc)</span>
        </button>
      </header>
      <div className="grid grid-cols-1 items-start gap-5 min-[921px]:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid min-w-0 gap-2" aria-label="Game">
          <Hud />
          <div className="relative aspect-[4/3] w-full max-w-full overflow-hidden rounded-md border-4 border-night-deep bg-night-deep shadow-[0_0_0_2px_var(--color-panel-edge),0_18px_50px_rgb(0_0_0/0.45)]">
            <GameCanvas />
            <Toast />
            <DialogBox />
            <DenyScreen />
            <PauseMenu />
          </div>
          <p className="m-0 text-[0.85rem] text-muted">
            Move: arrows or WASD · Talk and read: E or Enter · Sword: Space or J · Menu: Esc
          </p>
          <TouchPad />
        </section>
        <aside className="grid min-w-0 gap-3.5">
          <IdentityPanel />
          <GearPanel />
          <AccessLog />
          <Lessons />
        </aside>
      </div>
    </div>
  )
}

function PauseMenu() {
  const open = useQuest((s) => s.menuOpen)
  const savedAt = useQuest((s) => s.savedAt)
  const [confirmingRestart, setConfirmingRestart] = useState(false)

  if (!open) return null

  const restart = () => {
    quest.resetProgress()
    location.reload()
  }

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
        <button className={menuButton} type="button" onClick={() => quest.save()}>
          Save game
        </button>
        {confirmingRestart ? (
          <div className="grid gap-2 rounded border-2 border-deny p-3 text-[0.9rem]">
            <span>Restart from the village? Your lessons and progress are cleared.</span>
            <div className="flex gap-2">
              <button className={menuButton} type="button" onClick={restart}>
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

function GameCanvas() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let destroyed = false
    let destroy = () => {}

    void import('../game/scene.ts').then(({ startGame }) => {
      if (destroyed || !host.current) return
      const game = startGame(host.current)
      destroy = () => game.destroy(true)
    })

    return () => {
      destroyed = true
      destroy()
    }
  }, [])

  return <div className="pixelated" ref={host} />
}

function Hud() {
  const hp = useQuest((s) => s.hp)
  const region = useQuest((s) => s.region)
  const xp = useQuest((s) => s.xp)

  return (
    <div className="flex items-center justify-between gap-3 font-display text-[1.05rem]">
      <span aria-label={`${hp} of ${MAX_HP} hearts`}>
        {Array.from({ length: MAX_HP }, (_, i) => (
          <span key={i} className={i < hp ? 'mr-0.5 text-deny' : 'mr-0.5 text-heart-empty'}>
            ♥
          </span>
        ))}
      </span>
      <span className="text-sun">{region}</span>
      <span className="text-muted tabular-nums">Slimes {xp}</span>
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

  return (
    <div
      className="absolute right-2.5 bottom-2.5 left-2.5 max-h-[calc(100%-20px)] cursor-pointer overflow-auto rounded-md border-3 border-ink bg-night-deep/96 px-4 py-3 shadow-[0_0_0_3px_var(--color-night-deep)]"
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
      <p className="mt-2 text-right font-display text-[0.85rem] text-muted">
        {last ? 'Enter to close' : 'Enter to continue ▾'}
      </p>
    </div>
  )
}

function DenyScreen() {
  const deny = useQuest((s) => s.deny)

  if (!deny) return null

  return (
    <div
      className="absolute inset-0 grid items-start justify-items-center overflow-auto bg-[rgb(10_7_22/0.88)] p-3.5"
      role="alertdialog"
      aria-labelledby="deny-title"
    >
      <div className="w-[min(560px,100%)] rounded-lg border-t-6 border-deny bg-paper px-5 py-[18px] text-paper-ink [&_a]:text-paper-link">
        {deny.onBehalfOf && (
          <p className="mb-2 rounded bg-paper-tint px-2.5 py-1.5 text-[0.8rem] text-paper-muted">
            Not your request: this is what {deny.onBehalfOf} saw at the gate.
          </p>
        )}
        <p className="m-0 font-display text-[2.2rem] leading-none text-deny">{deny.status}</p>
        <h2 className="mt-0.5 mb-2 text-[1.25rem] font-bold" id="deny-title">
          {deny.title}
        </h2>
        <p className="m-0 text-[0.85rem] wrap-anywhere">
          <code>{deny.requestLine}</code>
        </p>
        <p className="mt-0.5 mb-2.5 text-[0.85rem] text-paper-muted">as {deny.who}</p>
        {deny.lines.length > 0 && (
          <div className="overflow-x-auto rounded bg-paper-tint px-2.5 py-2">
            <p className="mb-1 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase">
              Policy evaluation
            </p>
            {deny.lines.map((line, i) => (
              <div
                key={i}
                className={`grid grid-cols-[1.2em_max-content_1fr] items-baseline gap-2 text-[0.8rem] ${line.ok ? '' : 'text-[#c2183a]'}`}
              >
                <span className={line.ok ? 'text-[#15803d]' : ''}>{line.ok ? '✓' : '✗'}</span>
                <code className="whitespace-pre">{line.text}</code>
                {line.actual && <span className="text-[0.75rem] text-paper-muted">{line.actual}</span>}
              </div>
            ))}
          </div>
        )}
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
        <button
          className="mt-3.5 rounded bg-paper-ink px-3.5 py-2 text-paper"
          type="button"
          onClick={() => quest.closeDeny()}
        >
          Back to the kingdom
        </button>
      </div>
    </div>
  )
}

function TouchPad() {
  const hold = (dir: Dir) => ({
    onPointerDown: () => quest.hold(dir),
    onPointerUp: () => quest.hold(null),
    onPointerLeave: () => quest.hold(null),
    onPointerCancel: () => quest.hold(null),
  })

  const tap = (action: () => void) => () => {
    const { deny, dialog } = quest.get()

    if (deny) quest.closeDeny()
    else if (dialog) quest.advance()
    else action()
  }

  return (
    <div
      className="touch-pad touch-none items-center justify-between gap-4 px-1 py-2 select-none"
      aria-label="Touch controls"
    >
      <div className="dpad grid grid-cols-[repeat(3,52px)] grid-rows-[repeat(3,52px)]">
        <button type="button" className={`${padButton} [grid-area:up]`} aria-label="Up" {...hold('up')}>
          ▲
        </button>
        <button type="button" className={`${padButton} [grid-area:left]`} aria-label="Left" {...hold('left')}>
          ◀
        </button>
        <button
          type="button"
          className={`${padButton} [grid-area:right]`}
          aria-label="Right"
          {...hold('right')}
        >
          ▶
        </button>
        <button type="button" className={`${padButton} [grid-area:down]`} aria-label="Down" {...hold('down')}>
          ▼
        </button>
      </div>
      <div className="flex gap-3.5">
        <button
          type="button"
          className={`${actionButton} border-neon`}
          onClick={tap(() => quest.press('attack'))}
        >
          B<small className="font-body text-[0.6rem]">Sword</small>
        </button>
        <button
          type="button"
          className={`${actionButton} border-lime`}
          onClick={tap(() => quest.press('interact'))}
        >
          A<small className="font-body text-[0.6rem]">Talk</small>
        </button>
      </div>
    </div>
  )
}

function IdentityPanel() {
  const identity = useQuest((s) => s.identity)
  const mode = useQuest((s) => s.mode)
  const stage = useQuest((s) => s.stage)

  const claims = identity.authenticated
    ? JSON.stringify({ email: identity.email, groups: identity.groups }, null, 2)
    : null

  return (
    <section className={panel}>
      <h2 className={panelTitle}>Your identity</h2>
      <p
        className={`mb-1.5 inline-block rounded-full border border-current px-2 text-xs tracking-[0.06em] uppercase ${MODE_CHIP[mode]}`}
      >
        {MODE_LABEL[mode]}
      </p>
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
  const xp = useQuest((s) => s.xp)
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
          <span>Slimes defeated</span>
          <span className="tabular-nums">
            {xp}
            {xp < KNIGHT_XP && ` / ${KNIGHT_XP}`}
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
          {learned.length} of {LESSON_ORDER.length}
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
