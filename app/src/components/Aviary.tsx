// Chapter two's screens: the owl's perch, where the player sends real MCP requests through Pomerium (an
// MCP Inspector in the kingdom's clothes), and the chapter's ending. Nothing here decides access.
import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CHAPTER_TWO_LESSONS, LESSONS, link, type LessonId } from '../game/content.ts'
import { flyOwl } from '../game/owl-story.ts'
import { MCP_PATH, OWL_TOOLS, roostOrigin, type OwlTool, type Roost } from '../game/owl.ts'
import type { ToolInfo } from '../game/perch.ts'
import { quest, useQuest, type PerchView } from '../game/store.ts'
import { zoneRouteYaml } from '../game/story.ts'
import { zoneById } from '../game/zones.ts'
import { TabbedScreen, switchTab, tabHint } from './TabbedScreen.tsx'

const smallButton =
  'rounded border-2 border-panel-edge bg-panel px-2.5 py-1 font-display text-[0.85rem] text-ink hover:border-sun disabled:opacity-50'

const overlay =
  'absolute inset-0 grid items-start justify-items-center overflow-auto bg-[rgb(10_7_22/0.9)] p-3.5'

const paperCode = 'm-0 overflow-x-auto rounded bg-paper-tint px-3 py-2.5 text-[0.8rem] leading-[1.45]'
const paperLabel = 'm-0 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase'

const ROOSTS: Record<Roost, { readonly title: string; readonly about: string }> = {
  aviary: {
    title: "The Aviary's perch",
    about:
      "The owl flies from here to the Aviary and asks for an errand by name. Pick one, and watch what comes back. The Aviary's keeper checks every errand against their orders, as if you had asked yourself.",
  },
  rookery: {
    title: "The Rookery's perch",
    about:
      'From here the owl flies to the Rookery: the same errands as the Aviary, kept behind a different window with different orders. Only a falconer’s owl is let in.',
  },
}

/** What the perch's Pomerium tab links to. */
const PERCH_DOCS: readonly LessonId[] = ['mcpServer', 'mcpIdentity', 'mcpTool']

const isOwlTool = (name: string): name is OwlTool => Object.values<string>(OWL_TOOLS).includes(name)

/** The owl's perch. It steps aside while a dialog, a refusal or a sign-in has the player's attention. */
export function Perch() {
  const perch = useQuest((s) => s.perch)
  const covered = useQuest((s) => s.dialog !== null || s.deny !== null || s.signIn !== null)

  if (!perch || covered) return null

  return <PerchPanel perch={perch} />
}

function ToolButton({
  tool,
  perch,
  first,
}: {
  readonly tool: ToolInfo
  readonly perch: PerchView
  /** The first errand takes focus when the list arrives, so the keyboard can reach it without Tab. */
  readonly first: boolean
}) {
  const { name } = tool

  return (
    <li className="grid gap-1 rounded border-2 border-panel-edge px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <span className="font-display text-sun">{tool.title ?? name}</span>{' '}
          <code className="text-[0.8rem] text-lens">{name}</code>
        </span>
        <button
          className={`${smallButton} border-lens`}
          type="button"
          disabled={perch.busy || !isOwlTool(name)}
          autoFocus={first}
          onClick={() => {
            if (isOwlTool(name)) void flyOwl(perch.roost, { method: 'tools/call', tool: name })
          }}
        >
          Send the owl
        </button>
      </div>
      {tool.description && <p className="m-0 text-[0.85rem] text-muted">{tool.description}</p>}
    </li>
  )
}

/** What the owl brought back from its last errand, in the kingdom's words. */
function Returned({ perch }: { readonly perch: PerchView }) {
  const outcome = perch.flight?.outcome

  if (perch.busy) return <p className="m-0 text-[0.9rem] text-muted">The owl is on its way…</p>

  if (!outcome || outcome.kind === 'tools') return null

  if (outcome.kind === 'result') {
    return (
      <div className="grid gap-1">
        <p className="m-0 text-[0.9rem]">
          {outcome.failed ? 'The owl came back with nothing:' : 'The owl is back, and it brought this:'}
        </p>
        <pre className="m-0 overflow-x-auto rounded border border-panel-edge bg-code-bg px-3 py-2.5 text-[0.8rem] leading-[1.45] text-lens">
          {outcome.text}
        </pre>
      </div>
    )
  }

  return (
    <p className="m-0 text-[0.9rem] text-deny" role="alert">
      {outcome.kind === 'refused'
        ? 'The owl was turned back. Its guard said no.'
        : 'The owl came back without an answer.'}
    </p>
  )
}

function PerchPanel({ perch }: { readonly perch: PerchView }) {
  const { roost, tools, flight, busy } = perch
  const zone = zoneById(roost)
  const url = `${roostOrigin(location.origin, roost)}${MCP_PATH}`

  // Escape closes the perch wherever focus is.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      quest.closePerch()
    }

    window.addEventListener('keydown', onEscape)

    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  // The panel keeps its other keys: pressing a button must not walk the dog or open the menu.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') event.stopPropagation()
  }

  const actions = (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
      <button className={smallButton} type="button" onClick={() => quest.closePerch()}>
        Leave the perch
      </button>
      <button
        className={smallButton}
        type="button"
        disabled={busy}
        onClick={() => void flyOwl(roost, { method: 'tools/list' })}
      >
        Ask what errands there are
      </button>
    </div>
  )

  const kingdom = (
    <div className="flex flex-col gap-3 rounded-tr-lg rounded-b-lg border-3 border-ink bg-night-deep px-4 py-3.5">
      <h2 className="m-0 font-display text-[1.4rem] text-sun" id="perch-title-kingdom">
        {ROOSTS[roost].title}
      </h2>
      <p className="m-0 text-[0.9rem]">{ROOSTS[roost].about}</p>
      {tools ? (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Errands the owl can run">
          {tools.map((tool, index) => (
            <ToolButton key={tool.name} tool={tool} perch={perch} first={index === 0} />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[0.9rem] text-muted">
          {busy ? 'The owl is asking what errands there are…' : 'The owl has no list of errands from here.'}
        </p>
      )}
      <Returned perch={perch} />
      <p className="m-0 text-[0.85rem] text-muted">
        Every errand is a real request to an MCP server, through Pomerium. See it on the{' '}
        <button className="border-0 bg-transparent p-0 text-lens underline" type="button" onClick={switchTab}>
          In Pomerium
        </button>{' '}
        tab.
      </p>
      {actions}
    </div>
  )

  const pomerium = (
    <div className="flex flex-col gap-2.5 rounded-tr-lg rounded-b-lg border-t-6 border-lens bg-paper px-5 py-[18px] text-paper-ink [&_a]:text-paper-link [&_:focus-visible]:outline-paper-focus">
      <h2 className="m-0 text-[1.25rem] font-bold" id="perch-title-pomerium">
        The owl is an MCP client
      </h2>
      <p className="m-0 text-[0.9rem]">
        MCP (the Model Context Protocol) is how an AI agent calls tools on a server. This perch is the agent's
        side of it, without the AI: you pick the tool. The game's route for the perch is an MCP client route,
        so Pomerium hands the game a token for your session. The game sends each request to{' '}
        <code className="wrap-anywhere">{url}</code> with that token, and Pomerium checks it against the route
        below, as you.
      </p>
      <p className={paperLabel}>The route the owl flies to</p>
      <pre className={paperCode}>{zoneRouteYaml(zone)}</pre>
      {flight && (
        <>
          <p className={paperLabel}>The MCP request the owl carried</p>
          <pre className={paperCode}>{flight.request}</pre>
          <p className={paperLabel}>
            What came back{flight.status === null ? '' : ` · HTTP ${flight.status}`}
          </p>
          <pre className={paperCode}>{flight.response ?? 'Nothing came back.'}</pre>
          {flight.outcome.kind === 'refused' && (
            <p className="m-0 text-[0.9rem]">
              Pomerium refused this request before it reached the MCP server. It answers a refused MCP request
              with a JSON-RPC error, so an MCP client can read why.
            </p>
          )}
        </>
      )}
      <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-[0.85rem]">
        {PERCH_DOCS.map((lesson) => (
          <li key={lesson}>
            <a href={link(lesson).href} target="_blank" rel="noreferrer">
              Docs: {LESSONS[lesson].link.label} ↗
            </a>
          </li>
        ))}
      </ul>
      {actions}
    </div>
  )

  return (
    <div className="contents" onKeyDown={onKeyDown}>
      <TabbedScreen
        name="perch"
        label={ROOSTS[roost].title}
        showing={roost}
        overlay={overlay}
        role="dialog"
        kingdom={kingdom}
        pomerium={pomerium}
      />
    </div>
  )
}

const ERRANDS: readonly { readonly what: string; readonly how: string }[] = [
  {
    what: 'The owl flew as you',
    how: 'Pomerium signed it in with your session, and whoami read your claims back',
  },
  {
    what: 'One errand was refused',
    how: 'the Aviary’s deny rule named open_vault, and a deny beats an allow',
  },
  {
    what: 'A letter made you a falconer',
    how: 'a tool call asked the Oracle for a group, and the Mews opened',
  },
  {
    what: 'The same tool worked elsewhere',
    how: 'the Rookery is another route to the same server, with its own policy',
  },
  {
    what: 'The Throne Room let you in',
    how: 'one rule, five checks: three groups you earned, and two your owl earned for you',
  },
]

const closeEnd = () => quest.closeChapterTwoEnd()

const endButton =
  'motion-safe:animate-blink rounded border-3 border-night-deep bg-lime px-[18px] py-2.5 font-display text-[1.05rem] text-night-deep shadow-[4px_4px_0_var(--color-night-deep)]'

/** The Throne Room's doors open: chapter two is done, and so is the quest. */
export function ChapterTwoEnd() {
  const open = useQuest((s) => s.chapterTwoDone)
  const dialog = useQuest((s) => s.dialog)
  const learned = useQuest((s) => s.progress.lessons)

  useEffect(() => {
    if (!open) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeEnd()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open || dialog) return null

  const kingdom = (
    <div className="flex flex-col gap-3 rounded-tr-lg rounded-b-lg border-3 border-sun bg-night-deep px-5 py-[18px]">
      <h2 id="chapter-two-title-kingdom" className="sunset-text m-0 font-display text-[2rem] leading-tight">
        Chapter two complete
      </h2>
      <p className="m-0">
        The Throne Room opens its doors, the last gate in the kingdom. You walked in yourself, but your owl
        did the work that got you here:
      </p>
      <ul className="m-0 grid list-none gap-1.5 p-0">
        {ERRANDS.map(({ what, how }) => (
          <li key={what} className="flex items-baseline gap-2">
            <span className="text-allow">✓</span>
            <span>
              <strong className="font-display text-sun">{what}</strong>{' '}
              <span className="text-muted">· {how}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[0.85rem] text-muted">
        See what Pomerium did for the owl on the{' '}
        <button className="border-0 bg-transparent p-0 text-lens underline" type="button" onClick={switchTab}>
          In Pomerium
        </button>{' '}
        tab.
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <button className={endButton} type="button" onClick={closeEnd} autoFocus>
          Enter the Throne Room ▸
        </button>
        <p className={`${tabHint} text-muted`}>Esc to go in</p>
      </div>
    </div>
  )

  const pomerium = (
    <div className="flex flex-col gap-2.5 rounded-tr-lg rounded-b-lg border-t-6 border-allow bg-paper px-5 py-[18px] text-paper-ink [&_a]:text-paper-link [&_:focus-visible]:outline-paper-focus">
      <h2 className="m-0 text-[1.25rem] font-bold" id="chapter-two-title-pomerium">
        Agents get the same checks you do
      </h2>
      <p className="m-0 text-[0.9rem]">
        An MCP server behind Pomerium is a route like any other. Pomerium signs the MCP client in as its user,
        checks every request against the route's policy, and can allow or refuse a single tool by name with{' '}
        <code>mcp_tool</code>. The server behind the route gets a signed JWT saying who the agent acts for,
        and should verify it, as this game's MCP server does.
      </p>
      <p className={paperLabel}>
        Chapter two's lessons · {CHAPTER_TWO_LESSONS.filter((id) => learned.includes(id)).length} of{' '}
        {CHAPTER_TWO_LESSONS.length}
      </p>
      <ol className="m-0 grid list-decimal gap-[3px] pl-[1.4em] text-[0.85rem]">
        {CHAPTER_TWO_LESSONS.map((id) =>
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
      <p className="m-0 text-[0.9rem]">
        The same server works with a real agent. Point an MCP client such as Claude Code or the MCP Inspector
        at the Aviary's address, sign in with the Oracle when it asks, and it gets the same tools and the same
        refusals.
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
        <button className={endButton} type="button" onClick={closeEnd}>
          Enter the Throne Room ▸
        </button>
        <p className={`${tabHint} text-paper-muted`}>Esc to go in</p>
      </div>
    </div>
  )

  return (
    <TabbedScreen
      name="chapter-two"
      label="How the owl got you here"
      showing={open}
      overlay="fixed inset-0 z-50 grid place-items-center bg-[rgb(10_7_22/0.88)] p-4"
      kingdom={kingdom}
      pomerium={pomerium}
    />
  )
}
