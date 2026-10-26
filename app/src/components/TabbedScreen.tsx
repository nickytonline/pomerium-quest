// A moment told twice, as the kingdom tells it and as Pomerium decided it: the screens for a refusal,
// the finale and the house's desk all share these two tabs.
import { useEffect, useState, type ReactNode } from 'react'

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
 * one grid cell, so the screen keeps the taller one's size when switching.
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
        <div className="grid min-h-0 overflow-y-auto overscroll-contain">
          {TABS.map(({ id }) => (
            <div
              key={id}
              id={`${name}-panel-${id}`}
              className={`grid [grid-area:1/1] ${tab === id ? '' : 'invisible'}`}
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
