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

/**
 * A moment told twice: first as the game tells it, then as Pomerium decided it. Both tabs share
 * one grid cell, so the screen keeps the taller one's size when switching. A screen whose tabs differ a
 * lot in length asks for each tab to keep its own size instead: sized to the longer one, the shorter tab
 * would be mostly empty, with whatever is at its foot scrolled far out of view.
 */
export function TabbedScreen({
  name,
  label,
  showing,
  overlay,
  role = 'alertdialog',
  sized = 'tallest',
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
  /** Whether both tabs take the taller one's size, or each keeps its own. */
  readonly sized?: 'tallest' | 'each'
  readonly kingdom: ReactNode
  readonly pomerium: ReactNode
}) {
  const [tab, setTab] = useState<Tab>('kingdom')
  const panels = useRef<HTMLDivElement>(null)
  const away = sized === 'each' ? 'hidden' : 'invisible'

  // A tab opens at its top, not wherever the other one was scrolled to.
  useEffect(() => {
    panels.current?.scrollTo({ top: 0 })
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
        {/* One column that may shrink, so a long line scrolls inside its block instead of widening the screen. */}
        <div
          ref={panels}
          className="grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-y-auto overscroll-contain"
        >
          {TABS.map(({ id }) => (
            <div
              key={id}
              id={`${name}-panel-${id}`}
              className={`grid grid-cols-[minmax(0,1fr)] [grid-area:1/1] ${tab === id ? '' : away}`}
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
