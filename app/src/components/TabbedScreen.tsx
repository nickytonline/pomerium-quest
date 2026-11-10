// A moment told twice, as the kingdom tells it and as Pomerium decided it: the screens for a refusal,
// the finale and the house's desk all share these two tabs.
import { useEffect, useRef, useState, type ReactNode } from 'react'

type Tab = 'kingdom' | 'pomerium'

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'kingdom', label: 'In the kingdom' },
  { id: 'pomerium', label: 'In Pomerium' },
]

/** ← and → switch the open tabbed screen's tabs; the screen listens for it. */
export const TAB_EVENT = 'quest:switch-tab'

export const switchTab = () => window.dispatchEvent(new Event(TAB_EVENT))

/** How each tab's panel is laid out. */
const PANEL: Record<Tab, string> = {
  // The kingdom's panel sets the screen's height.
  kingdom: 'grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] [grid-area:1/1]',
  // The Pomerium panel is laid over the kingdom's, so it adds no height of its own.
  pomerium: 'absolute inset-0 grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]',
}

/**
 * One tab's content. Its text scrolls when the screen is too short for it; its buttons stay put below the
 * text, still inside the pane, so they are always in reach and focusing one never scrolls the text away.
 */
export function TabPane({
  className,
  body = '',
  actions,
  children,
}: {
  /** The pane's own look: its border, background and text colour. */
  readonly className: string
  /** How the text is spaced, such as the gap between its parts. */
  readonly body?: string
  /** The buttons at the pane's foot. */
  readonly actions: ReactNode
  readonly children: ReactNode
}) {
  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-[18px] pb-2 [&>*]:shrink-0 ${body}`}
        data-tab-text
        // Focusable, so the keyboard can scroll the text while the buttons below it stay where they are.
        tabIndex={0}
      >
        {children}
      </div>
      <div className="px-5 pb-[18px]">{actions}</div>
    </div>
  )
}

/**
 * A moment told twice: first as the game tells it, then as Pomerium decided it. The kingdom tab sets the
 * screen's size, between a least and a greatest height, and the Pomerium tab, often much the longer,
 * scrolls inside that space. So the screen keeps one size when switching, and the kingdom tab is never
 * mostly empty.
 */
export function TabbedScreen({
  name,
  label,
  showing,
  overlay,
  role = 'alertdialog',
  kingdom,
  pomerium,
}: {
  readonly name: string
  readonly label: string
  /** What the screen is showing; a new one starts back on the kingdom tab. */
  readonly showing: unknown
  readonly overlay: string
  /** A refusal or a result is an alert; a screen the player works in is a plain dialog. */
  readonly role?: 'alertdialog' | 'dialog'
  readonly kingdom: ReactNode
  readonly pomerium: ReactNode
}) {
  const [tab, setTab] = useState<Tab>('kingdom')
  const panels = useRef<HTMLDivElement>(null)

  // A tab opens at the top of its text, not wherever it was last scrolled to.
  useEffect(() => {
    for (const text of panels.current?.querySelectorAll('[data-tab-text]') ?? []) text.scrollTo({ top: 0 })
  }, [tab, showing])

  useEffect(() => {
    setTab('kingdom')
  }, [showing])

  useEffect(() => {
    const onSwitch = () => setTab((current) => (current === 'kingdom' ? 'pomerium' : 'kingdom'))
    window.addEventListener(TAB_EVENT, onSwitch)

    return () => window.removeEventListener(TAB_EVENT, onSwitch)
  }, [])

  return (
    <div className={overlay} role={role} aria-modal="true" aria-labelledby={`${name}-title-${tab}`}>
      <div className="flex max-h-full w-[min(600px,100%)] min-h-0 flex-col">
        <div className="flex gap-1" role="tablist" aria-label={label}>
          {TABS.map(({ id, label: tabLabel }) => (
            <button
              key={id}
              id={`${name}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`${name}-panel-${id}`}
              className={`rounded-t-md border-2 border-b-0 px-3 py-1.5 font-display text-[0.95rem] ${tab === id ? (id === 'kingdom' ? 'border-ink bg-night-deep text-sun' : 'border-paper bg-paper text-paper-ink') : 'border-panel-edge bg-panel text-muted hover:text-ink'}`}
              onClick={() => setTab(id)}
            >
              {tabLabel}
            </button>
          ))}
        </div>
        {/* One column and one row that may shrink, and code that wraps: a long line never widens the screen or
            scrolls sideways, and a tall pane scrolls its own text. */}
        <div
          ref={panels}
          className={`relative grid max-h-[75dvh] min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden [&_pre]:overflow-x-hidden [&_pre]:wrap-anywhere [&_pre]:whitespace-pre-wrap`}
        >
          {/* A short kingdom tab still leaves room to read the Pomerium one: this sets the least height. It is
              only a wish, so a screen with less room than that shrinks past it instead of spilling out. */}
          <div className="pointer-events-none invisible h-[min(20rem,60dvh)] [grid-area:1/1]" />
          {TABS.map(({ id }) => (
            <div
              key={id}
              id={`${name}-panel-${id}`}
              className={`${PANEL[id]} ${tab === id ? '' : 'invisible'}`}
              role="tabpanel"
              aria-labelledby={`${name}-tab-${id}`}
              aria-hidden={tab !== id}
            >
              {id === 'kingdom' ? kingdom : pomerium}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The keys hint under a tabbed screen. */
export const tabHint = 'm-0 text-right font-display text-[0.85rem]'
