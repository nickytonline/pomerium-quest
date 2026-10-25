import { useEffect, useRef, useState } from 'react'
import { probe } from '../game/access.ts'
import { INTRO, LESSONS, LESSON_ORDER } from '../game/content.ts'
import type { Identity } from '../game/ppl.ts'
import { KNIGHT_XP, questMachine, type QuestStage } from '../game/quest-machine.ts'
import { MAX_HP, quest, useQuest, type Dir } from '../game/store.ts'

const groupsOf = (identity: Identity) => {
  const groups = identity.claims['groups']
  return Array.isArray(groups) ? groups.map(String) : []
}

const STAGE_LABEL: Record<QuestStage, string> = {
  anonymous: 'Anonymous',
  citizen: 'Citizen',
  proven: 'Proven',
  knighted: 'Knighted (stale claims)',
  knight: 'Knight',
  armed: 'Armed knight',
}

const stageDescription = (stage: QuestStage) => questMachine.getStateNodeById(`quest.${stage}`).description ?? ''

/** Detects Pomerium, restores the player's identity, and handles the sign-in round trip. */
function useBoot() {
  useEffect(() => {
    const url = new URL(location.href)
    const returning = url.searchParams.has('signedin')
    if (returning) history.replaceState(null, '', url.pathname)
    void probe(quest.get().progress).then(({ mode, identity }) => {
      quest.setMode(mode, identity)
      if (identity.authenticated) quest.send({ type: 'SIGNED_IN', groups: groupsOf(identity) })
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
      if (event.repeat || event.defaultPrevented) return
      const { deny, dialog } = quest.get()
      const confirm = event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E'
      if (deny && (confirm || event.key === 'Escape')) {
        event.preventDefault()
        quest.closeDeny()
      } else if (dialog && confirm) {
        event.preventDefault()
        quest.advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function Quest() {
  useBoot()
  useDialogKeys()
  const started = useQuest(s => s.started)
  return started ? <Kingdom /> : <Splash />
}

function Splash() {
  const mode = useQuest(s => s.mode)
  const begin = () => {
    quest.start()
    if (quest.get().progress.lessons.length === 0) quest.say(INTRO)
  }
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
    <main className="splash">
      <img className="splash-art" src="/assets/splash.png" alt="The Pomerium Pomeranian in aviators and a leather jacket" />
      <h1 className="splash-title">Pomerium Quest</h1>
      <p className="splash-tagline">Every gate has a guard. Every guard checks you, every time.</p>
      <button className="splash-start" type="button" onClick={begin} autoFocus>
        Press Enter to start
      </button>
      <p className="splash-mode">
        {mode === 'loading' && 'Looking for Pomerium…'}
        {mode === 'pomerium' && 'Connected to a real Pomerium. Every gate is a live route.'}
        {mode === 'simulated' && 'Simulated mode: no Pomerium detected, so policies run in your browser.'}
      </p>
    </main>
  )
}

function Kingdom() {
  return (
    <div className="kingdom">
      <header className="masthead">
        <h1>Pomerium Quest</h1>
        <p>Chapter one · Identity and access</p>
      </header>
      <div className="layout">
        <section className="game-column" aria-label="Game">
          <Hud />
          <div className="screen">
            <GameCanvas />
            <Toast />
            <DialogBox />
            <DenyScreen />
          </div>
          <p className="help">Move: arrows or WASD · Talk and read: E or Enter · Sword: Space or J</p>
          <TouchPad />
        </section>
        <aside className="panels">
          <IdentityPanel />
          <GearPanel />
          <AccessLog />
          <Lessons />
        </aside>
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
  return <div className="canvas-host" ref={host} />
}

function Hud() {
  const hp = useQuest(s => s.hp)
  const region = useQuest(s => s.region)
  const xp = useQuest(s => s.xp)
  return (
    <div className="hud">
      <span className="hearts" aria-label={`${hp} of ${MAX_HP} hearts`}>
        {Array.from({ length: MAX_HP }, (_, i) => (
          <span key={i} className={i < hp ? 'heart full' : 'heart'}>
            ♥
          </span>
        ))}
      </span>
      <span className="region">{region}</span>
      <span className="xp">Slimes {xp}</span>
    </div>
  )
}

function Toast() {
  const toast = useQuest(s => s.toast)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => quest.clearToast(toast.id), 2600)
    return () => clearTimeout(timer)
  }, [toast])
  if (!toast) return null
  return (
    <div className={`toast toast-${toast.tone}`} role="status">
      {toast.text}
    </div>
  )
}

function DialogBox() {
  const dialog = useQuest(s => s.dialog)
  if (!dialog) return null
  const page = dialog.pages[dialog.index]
  if (!page) return null
  const last = dialog.index === dialog.pages.length - 1
  return (
    <div className="dialog" role="dialog" aria-live="polite" onClick={() => quest.advance()}>
      <p className="dialog-who">{page.who}</p>
      <p className="dialog-text">{page.text}</p>
      {page.code && <pre className="dialog-code">{page.code}</pre>}
      {page.links && page.links.length > 0 && (
        <ul className="doc-links">
          {page.links.map(doc => (
            <li key={doc.href + doc.label}>
              <a href={doc.href} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
                Docs: {doc.label} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="dialog-next">{last ? 'Enter to close' : 'Enter to continue ▾'}</p>
    </div>
  )
}

function DenyScreen() {
  const deny = useQuest(s => s.deny)
  if (!deny) return null
  return (
    <div className="deny" role="alertdialog" aria-labelledby="deny-title">
      <div className="deny-card">
        <p className="deny-status">{deny.status}</p>
        <h2 id="deny-title">{deny.title}</h2>
        <p className="deny-request">
          <code>{deny.requestLine}</code>
        </p>
        <p className="deny-who">as {deny.who}</p>
        {deny.lines.length > 0 && (
          <div className="deny-policy">
            <p className="deny-label">Policy evaluation</p>
            {deny.lines.map((line, i) => (
              <div key={i} className={line.ok ? 'eval ok' : 'eval no'}>
                <span className="eval-mark">{line.ok ? '✓' : '✗'}</span>
                <code className="eval-text">{line.text}</code>
                {line.actual && <span className="eval-actual">{line.actual}</span>}
              </div>
            ))}
          </div>
        )}
        <p className="deny-hint">{deny.hint}</p>
        <ul className="doc-links">
          {deny.links.map(doc => (
            <li key={doc.href + doc.label}>
              <a href={doc.href} target="_blank" rel="noreferrer">
                Docs: {doc.label} ↗
              </a>
            </li>
          ))}
        </ul>
        <button className="deny-back" type="button" onClick={() => quest.closeDeny()}>
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
    <div className="pad" aria-label="Touch controls">
      <div className="dpad">
        <button type="button" className="up" aria-label="Up" {...hold('up')}>
          ▲
        </button>
        <button type="button" className="left" aria-label="Left" {...hold('left')}>
          ◀
        </button>
        <button type="button" className="right" aria-label="Right" {...hold('right')}>
          ▶
        </button>
        <button type="button" className="down" aria-label="Down" {...hold('down')}>
          ▼
        </button>
      </div>
      <div className="actions">
        <button type="button" className="btn-b" onClick={tap(() => quest.press('attack'))}>
          B<small>Sword</small>
        </button>
        <button type="button" className="btn-a" onClick={tap(() => quest.press('interact'))}>
          A<small>Talk</small>
        </button>
      </div>
    </div>
  )
}

function IdentityPanel() {
  const identity = useQuest(s => s.identity)
  const mode = useQuest(s => s.mode)
  const stage = useQuest(s => s.stage)
  const claims = identity.authenticated
    ? JSON.stringify({ email: identity.email, groups: groupsOf(identity) }, null, 2)
    : null
  return (
    <section className="panel">
      <h2>Your identity</h2>
      <p className={`mode mode-${mode}`}>
        {mode === 'pomerium' ? 'Live Pomerium' : mode === 'simulated' ? 'Simulated' : 'Detecting…'}
      </p>
      {claims ? (
        <pre className="claims">{claims}</pre>
      ) : (
        <p className="muted">No session. Visit the Oracle to sign in.</p>
      )}
      <p className="stage">
        <span className="stage-label">{STAGE_LABEL[stage]}</span>
        <span className="muted">{stageDescription(stage)}</span>
      </p>
    </section>
  )
}

function GearPanel() {
  const stage = useQuest(s => s.stage)
  const xp = useQuest(s => s.xp)
  const steel = stage === 'armed'
  return (
    <section className="panel">
      <h2>Gear</h2>
      <ul className="gear">
        <li>
          <span>{steel ? 'Steel sword' : 'Wooden sword'}</span>
          <span className="muted">{steel ? 'breaks rock' : 'starter'}</span>
        </li>
        <li>
          <span>Wooden shield</span>
          <span className="muted">starter</span>
        </li>
        <li>
          <span>Slimes defeated</span>
          <span className="num">
            {xp}
            {xp < KNIGHT_XP && ` / ${KNIGHT_XP}`}
          </span>
        </li>
      </ul>
    </section>
  )
}

function AccessLog() {
  const log = useQuest(s => s.log)
  return (
    <section className="panel">
      <h2>Access log</h2>
      {log.length === 0 ? (
        <p className="muted">Every request a guard checks shows up here.</p>
      ) : (
        <ol className="log">
          {log.map(entry => (
            <li key={entry.id}>
              <span className="log-time">{entry.at}</span>
              <span className={`chip chip-${entry.decision === 'ALLOW' ? 'allow' : 'deny'}`}>{entry.decision}</span>
              <code className="log-req">
                {entry.method} {entry.path}
              </code>
              <span className="log-who">{entry.who}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Lessons() {
  const learned = useQuest(s => s.progress.lessons)
  const [confirming, setConfirming] = useState(false)
  return (
    <section className="panel">
      <h2>
        Lessons <span className="muted">{learned.length} of {LESSON_ORDER.length}</span>
      </h2>
      <ol className="lessons">
        {LESSON_ORDER.map(id =>
          learned.includes(id) ? (
            <li key={id}>
              <a href={LESSONS[id].link.href} target="_blank" rel="noreferrer">
                {LESSONS[id].title} ↗
              </a>
            </li>
          ) : (
            <li key={id} className="locked">
              Not learned yet
            </li>
          ),
        )}
      </ol>
      {confirming ? (
        <p className="reset">
          Start over from the beginning?{' '}
          <button
            type="button"
            onClick={() => {
              quest.resetProgress()
              location.reload()
            }}
          >
            Yes, reset
          </button>{' '}
          <button type="button" onClick={() => setConfirming(false)}>
            Keep playing
          </button>
        </p>
      ) : (
        <button className="reset-link" type="button" onClick={() => setConfirming(true)}>
          Reset progress
        </button>
      )}
    </section>
  )
}
