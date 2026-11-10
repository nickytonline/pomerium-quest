// Chapter two's screens: a perch's panel, which explains the real MCP tool call the owl just made through
// Pomerium, and the chapter's ending. Nothing here decides access.
import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { CHAPTER_TWO_LESSONS, LESSONS, link, type LessonId } from '../game/content.ts'
import { GROUPS } from '../game/groups.ts'
import { FALCONERS_PAPERS, flyOwl, leaveFalconersErrand, leavePerch } from '../game/owl-story.ts'
import { MCP_PATH, OWL_ERRANDS, OWL_TOOLS, aviaryOrigin, type OwlTool } from '../game/owl.ts'
import { decide } from '../game/ppl.ts'
import type { OwlFlight } from '../game/perch.ts'
import { quest, useQuest, type PerchView } from '../game/store.ts'
import { zoneRouteYaml } from '../game/story.ts'
import { zoneById } from '../game/zones.ts'
import { PolicyLines } from './PolicyLines.tsx'
import { TabPane, TabbedScreen, switchTab, tabHint } from './TabbedScreen.tsx'

const smallButton =
  'rounded border-2 border-panel-edge bg-panel px-2.5 py-1 font-display text-[0.85rem] text-ink hover:border-sun disabled:opacity-50'

const overlay = 'absolute inset-0 flex items-center justify-center bg-[rgb(10_7_22/0.9)] p-3.5'

const paperCode = 'm-0 overflow-x-auto rounded bg-paper-tint px-3 py-2.5 text-[0.8rem] leading-[1.45]'
const paperLabel = 'm-0 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase'

/** What the perch's Pomerium tab links to. */
const PERCH_DOCS: readonly LessonId[] = ['mcpServer', 'mcpIdentity', 'mcpTool']

/** How the kingdom tells what the owl brought back from each errand. */
const BROUGHT: Partial<Record<OwlTool, string>> = {
  [OWL_TOOLS.whoami]: 'The owl is back. This is who it flew for:',
  [OWL_TOOLS.ringBell]: 'The owl is back, and the bell is still humming:',
  [OWL_TOOLS.scoutGrounds]: 'The owl is back, with news from high above the grounds:',
  [OWL_TOOLS.deliverLetter]: 'The owl is back, with a note from the Oracle tied to its leg:',
}

/**
 * A perch's panel: the explainer for an errand that ran. The owl lands first, in full view, and the text box
 * says it has a message; the panel opens when the player asks to read it. It steps aside while a dialog, a
 * refusal or a sign-in has the player's attention.
 */
export function Perch() {
  const perch = useQuest((s) => s.perch)
  const covered = useQuest((s) => s.dialog !== null || s.deny !== null || s.signIn !== null)

  if (!perch || covered || !perch.explained || perch.phase !== 'done' || !perch.flight) return null

  return <PerchPanel perch={perch} flight={perch.flight} />
}

/** What the owl brought back from its errand, in the kingdom's words. */
function Returned({ perch, flight }: { readonly perch: PerchView; readonly flight: OwlFlight }) {
  const { outcome } = flight

  if (outcome.kind !== 'result') {
    return (
      <p className="m-0 text-[0.9rem] text-deny" role="alert">
        The owl came back without an answer.
      </p>
    )
  }

  return (
    <div className="grid gap-1">
      <p className="m-0 text-[0.9rem]">
        {outcome.failed
          ? 'The owl came back with nothing:'
          : (BROUGHT[perch.tool] ?? 'The owl is back, and it brought this:')}
      </p>
      <pre className="m-0 overflow-x-auto rounded border border-panel-edge bg-code-bg px-3 py-2.5 text-[0.8rem] leading-[1.45] text-lens">
        {outcome.text}
      </pre>
    </div>
  )
}

function PerchPanel({ perch, flight }: { readonly perch: PerchView; readonly flight: OwlFlight }) {
  const { tool } = perch
  const { title, description } = OWL_ERRANDS[tool]
  const zone = zoneById('aviary')
  const url = `${aviaryOrigin(location.origin)}${MCP_PATH}`
  const identity = useQuest((s) => s.identity)

  // Escape leaves the perch wherever focus is.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      leavePerch()
    }

    window.addEventListener('keydown', onEscape)

    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  // The panel keeps its other keys: pressing a button must not walk the dog or open the menu.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') event.stopPropagation()
  }

  const actions = (focus: boolean) => (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <button className={smallButton} type="button" autoFocus={focus} onClick={leavePerch}>
        Leave the perch
      </button>
      <button className={`${smallButton} border-lens`} type="button" onClick={() => void flyOwl(tool)}>
        Send the owl again
      </button>
    </div>
  )

  const kingdom = (
    <TabPane
      className="rounded-tr-lg rounded-b-lg border-3 border-ink bg-night-deep"
      body="gap-3"
      actions={actions(true)}
    >
      <h2 className="m-0 font-display text-[1.4rem] text-sun" id="perch-title-kingdom">
        {title} <code className="text-[0.85rem] text-lens">{tool}</code>
      </h2>
      <p className="m-0 text-[0.9rem]">{description}</p>
      <Returned perch={perch} flight={flight} />
      <p className="m-0 text-[0.9rem]">
        The owl flew this errand on your behalf, carrying your papers. Nothing stands around the perch: the
        Aviary's orders alone decided that it could.
      </p>
      <p className="m-0 text-[0.85rem] text-muted">
        Sending the owl was a real request to an MCP server, through Pomerium. See it on the{' '}
        <button className="border-0 bg-transparent p-0 text-lens underline" type="button" onClick={switchTab}>
          In Pomerium
        </button>{' '}
        tab.
      </p>
    </TabPane>
  )

  const pomerium = (
    <TabPane
      className="rounded-tr-lg rounded-b-lg border-t-6 border-lens bg-paper text-paper-ink [&_a]:text-paper-link [&_:focus-visible]:outline-paper-focus"
      body="gap-2.5"
      actions={actions(false)}
    >
      <h2 className="m-0 text-[1.25rem] font-bold" id="perch-title-pomerium">
        Sending the owl is a tool call
      </h2>
      <p className="m-0 text-[0.9rem]">
        MCP (the Model Context Protocol) is how an AI agent calls tools on a server. The owl is the MCP
        client, without the AI: you pick the tool by picking the perch. The game sends it from an MCP client
        route, so Pomerium hands the game a token for your session. The game sends the <code>tools/call</code>{' '}
        request for <code>{tool}</code> to <code className="wrap-anywhere">{url}</code> with that token, and
        Pomerium checks it against the route below. The owl acts on your behalf, so the claims Pomerium checks
        are yours.
      </p>
      <p className={paperLabel}>The route the owl flies to</p>
      <pre className={paperCode}>{zoneRouteYaml(zone)}</pre>
      <p className={paperLabel}>The MCP request the owl carried</p>
      <pre className={paperCode}>{flight.request}</pre>
      <p className={paperLabel}>What came back{flight.status === null ? '' : ` · HTTP ${flight.status}`}</p>
      <pre className={paperCode}>{flight.response ?? 'Nothing came back.'}</pre>
      <p className={paperLabel}>How Pomerium decided</p>
      <PolicyLines lines={decide(zone, identity, { method: 'POST', path: MCP_PATH, tool }).lines} />
      <p className="m-0 text-[0.9rem]">
        An allow rule matched and no deny rule did, so Pomerium passed the request on to the MCP server, with
        a signed JWT saying who the owl flies for.
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-[0.85rem]">
        {PERCH_DOCS.map((lesson) => (
          <li key={lesson}>
            <a href={link(lesson).href} target="_blank" rel="noreferrer">
              Docs: {LESSONS[lesson].link.label} ↗
            </a>
          </li>
        ))}
      </ul>
    </TabPane>
  )

  return (
    <div className="contents" onKeyDown={onKeyDown}>
      <TabbedScreen
        name="perch"
        label={`${title} perch`}
        showing={tool}
        overlay={overlay}
        role="dialog"
        kingdom={kingdom}
        pomerium={pomerium}
      />
    </div>
  )
}

/** What the Falconer's errand's Pomerium tab links to. */
const CAGE_DOCS: readonly LessonId[] = ['mcpTool', 'mcpIdentity', 'denyWins']

/**
 * What the Falconer's owl brought back from the cage: the same tool call the player's owl was refused,
 * allowed on the Falconer's behalf. It opens when the player asks to read it, like a perch's panel.
 */
export function FalconersErrand() {
  const errand = useQuest((s) => s.falconersErrand)
  const covered = useQuest((s) => s.dialog !== null || s.deny !== null || s.signIn !== null)

  if (!errand || covered || !errand.explained || errand.phase !== 'done' || !errand.flight) return null

  return <FalconersErrandPanel flight={errand.flight} />
}

function FalconersErrandPanel({ flight }: { readonly flight: OwlFlight }) {
  const tool = OWL_TOOLS.openCage
  const { title } = OWL_ERRANDS[tool]
  const zone = zoneById('aviary')
  const url = `${aviaryOrigin(location.origin)}${MCP_PATH}`
  const identity = useQuest((s) => s.identity)
  const request = { method: 'POST', path: MCP_PATH, tool } as const
  const { outcome } = flight

  // Escape leaves the panel wherever focus is.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      leaveFalconersErrand()
    }

    window.addEventListener('keydown', onEscape)

    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  // The panel keeps its other keys: pressing a button must not walk the dog or open the menu.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') event.stopPropagation()
  }

  const actions = (focus: boolean) => (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <button className={smallButton} type="button" autoFocus={focus} onClick={leaveFalconersErrand}>
        Back to the Falconer
      </button>
    </div>
  )

  const kingdom = (
    <TabPane
      className="rounded-tr-lg rounded-b-lg border-3 border-ink bg-night-deep"
      body="gap-3"
      actions={actions(true)}
    >
      <h2 className="m-0 font-display text-[1.4rem] text-sun" id="cage-title-kingdom">
        {title} <code className="text-[0.85rem] text-lens">{tool}</code>
      </h2>
      <div className="grid gap-1">
        <p className="m-0 text-[0.9rem]">
          The Falconer's owl is back on the glove, and Mochi's owl is out of its cage. This is the keeper's
          answer:
        </p>
        <pre className="m-0 overflow-x-auto rounded border border-panel-edge bg-code-bg px-3 py-2.5 text-[0.8rem] leading-[1.45] text-lens">
          {outcome.kind === 'result' ? outcome.text : 'The owl came back without an answer.'}
        </pre>
      </div>
      <p className="m-0 text-[0.9rem]">
        It was the errand your owl was refused, under the same orders. The keeper didn't weigh who asked more
        nicely. The Falconer's owl flies on the Falconer's behalf, and the Falconer's papers say{' '}
        {GROUPS.distinguishedFalconers}. Yours don't.
      </p>
      <p className="m-0 text-[0.85rem] text-muted">
        This was a real request to an MCP server, through Pomerium, made as the Falconer. See it beside yours
        on the{' '}
        <button className="border-0 bg-transparent p-0 text-lens underline" type="button" onClick={switchTab}>
          In Pomerium
        </button>{' '}
        tab.
      </p>
    </TabPane>
  )

  const pomerium = (
    <TabPane
      className="rounded-tr-lg rounded-b-lg border-t-6 border-lens bg-paper text-paper-ink [&_a]:text-paper-link [&_:focus-visible]:outline-paper-focus"
      body="gap-2.5"
      actions={actions(false)}
    >
      <h2 className="m-0 text-[1.25rem] font-bold" id="cage-title-pomerium">
        The same tool call, on someone else's behalf
      </h2>
      <p className="m-0 text-[0.9rem]">
        The Falconer has an account of their own at the identity provider:{' '}
        <code className="wrap-anywhere">{FALCONERS_PAPERS.email}</code>. The game signed in as the Falconer
        and sent the same <code>tools/call</code> request for <code>{tool}</code> to{' '}
        <code className="wrap-anywhere">{url}</code>. Pomerium checked it against the same route. The only
        difference is whose session the token stands for.
      </p>
      <p className={paperLabel}>The route both owls fly to</p>
      <pre className={paperCode}>{zoneRouteYaml(zone)}</pre>
      <p className={paperLabel}>The MCP request the Falconer's owl carried</p>
      <pre className={paperCode}>{flight.request}</pre>
      <p className={paperLabel}>What came back{flight.status === null ? '' : ` · HTTP ${flight.status}`}</p>
      <pre className={paperCode}>{flight.response ?? 'Nothing came back.'}</pre>
      <p className={paperLabel}>How Pomerium decided for the Falconer</p>
      <PolicyLines lines={decide(zone, FALCONERS_PAPERS, request, 'their').lines} />
      <p className={paperLabel}>How it decided for you</p>
      <PolicyLines lines={decide(zone, identity, request).lines} />
      <p className="m-0 text-[0.9rem]">
        The deny rule has two checks, and it only matches when both pass. <code>exclude</code> passes when a
        list doesn't hold the value. The Falconer's groups do hold{' '}
        <code>{GROUPS.distinguishedFalconers}</code>, so that check fails, the deny rule doesn't match, and
        the allow stands. Your groups don't hold it, so both checks pass, the deny rule matches, and a deny
        beats an allow.
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-[0.85rem]">
        {CAGE_DOCS.map((lesson) => (
          <li key={lesson}>
            <a href={link(lesson).href} target="_blank" rel="noreferrer">
              Docs: {LESSONS[lesson].link.label} ↗
            </a>
          </li>
        ))}
      </ul>
    </TabPane>
  )

  return (
    <div className="contents" onKeyDown={onKeyDown}>
      <TabbedScreen
        name="cage"
        label="The Falconer's owl opens the cage"
        showing={flight}
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
    what: 'You caught your owl',
    how: 'an MCP client that flies on your behalf, carrying your claims',
  },
  {
    what: 'The Aviary turned it back',
    how: 'its one route asks for falconers, and the check came before any tool was looked at',
  },
  {
    what: 'The Falconer vouched for you',
    how: 'your claims changed; the owl, the perches and the policy did not',
  },
  {
    what: 'Two errands were refused to your owl',
    how: 'one deny rule matches a tool that starts with open_, called for anyone who is no distinguished falconer',
  },
  {
    what: 'A letter made you a keyholder',
    how: 'a tool call asked the Oracle for a group, and the Eyrie’s gate was waiting for it',
  },
  {
    what: 'The Falconer’s owl opened the cage',
    how: 'the same tool call, allowed on the Falconer’s behalf: Pomerium checked another identity',
  },
  {
    what: 'You brought Mochi their owl',
    how: 'another MCP client, flying on Mochi’s behalf, not yours',
  },
]

const closeEnd = () => quest.closeChapterTwoEnd()

const endButton =
  'motion-safe:animate-blink rounded border-3 border-night-deep bg-lime px-[18px] py-2.5 font-display text-[1.05rem] text-night-deep shadow-[4px_4px_0_var(--color-night-deep)]'

/** The player brought Mochi their owl in the Eyrie: chapter two is done, and so is the quest. */
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
    <TabPane
      className="rounded-tr-lg rounded-b-lg border-3 border-sun bg-night-deep"
      body="gap-3"
      actions={
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button className={endButton} type="button" onClick={closeEnd} autoFocus>
            On to the celebration ▸
          </button>
          <p className={`${tabHint} text-muted`}>Esc to go on</p>
        </div>
      }
    >
      <h2 id="chapter-two-title-kingdom" className="sunset-text m-0 font-display text-[2rem] leading-tight">
        Chapter two complete
      </h2>
      <p className="m-0">
        You found Mochi in the Eyrie, behind the last gate in the kingdom, and brought their owl home. You
        walked in yourself, but your owl did the work that got you here:
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
    </TabPane>
  )

  const pomerium = (
    <TabPane
      className="rounded-tr-lg rounded-b-lg border-t-6 border-allow bg-paper text-paper-ink [&_a]:text-paper-link [&_:focus-visible]:outline-paper-focus"
      body="gap-2.5"
      actions={
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
          <button className={endButton} type="button" onClick={closeEnd}>
            On to the celebration ▸
          </button>
          <p className={`${tabHint} text-paper-muted`}>Esc to go on</p>
        </div>
      }
    >
      <h2 className="m-0 text-[1.25rem] font-bold" id="chapter-two-title-pomerium">
        Agents get the same checks you do
      </h2>
      <p className="m-0 text-[0.9rem]">
        An MCP server behind Pomerium is a route like any other. Pomerium signs the MCP client in as its user,
        checks every request against the route's policy, and can allow or refuse tools by name with{' '}
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
    </TabPane>
  )

  return (
    <TabbedScreen
      name="chapter-two"
      label="How the owl got you here"
      showing={open}
      overlay="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(10_7_22/0.88)] p-4"
      kingdom={kingdom}
      pomerium={pomerium}
    />
  )
}
