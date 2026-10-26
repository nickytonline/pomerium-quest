// The player's house (docs/prd/your-house.md): the desk where they write their door rules. The rules
// become a real Pomerium route; nothing here decides access.
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { LESSONS, link, type LessonId } from '../game/content.ts'
import {
  HOUSE_LIMITS,
  HOUSE_VALUE,
  VISITOR_IDS,
  VISITORS,
  turnsAwayOwner,
  type HouseCriterion,
  type HouseRule,
} from '../game/house.ts'
import { currentLetter, houseRouteYaml, saveDoorRules } from '../game/house-story.ts'
import { quest, useQuest } from '../game/store.ts'
import { KINGDOM_DOMAIN } from '../game/zones.ts'
import { TabbedScreen, switchTab } from './TabbedScreen.tsx'

type Kind = HouseCriterion['kind']

const KINDS: readonly { readonly kind: Kind; readonly label: string }[] = [
  { kind: 'email', label: 'email is' },
  { kind: 'domain', label: 'email domain is' },
  { kind: 'claim', label: 'groups claim has' },
  { kind: 'http_method', label: 'request method is' },
  { kind: 'authenticated_user', label: 'is signed in' },
  { kind: 'accept', label: 'anyone, even with no session' },
]

const ACTIONS: readonly { readonly value: HouseRule['action']; readonly label: string }[] = [
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
]

const MATCHES: readonly { readonly value: HouseRule['match']; readonly label: string }[] = [
  { value: 'or', label: 'any of these (or)' },
  { value: 'and', label: 'all of these (and)' },
  { value: 'not', label: 'none of these (not)' },
]

/** A fresh check of each kind; an email check starts as the first visitor the desk lists. */
function blank(kind: Kind): HouseCriterion {
  switch (kind) {
    case 'accept':
    case 'authenticated_user':
      return { kind }
    case 'email':
      return { kind, is: peopleWith()[0]?.email ?? '' }
    case 'domain':
      return { kind, is: KINGDOM_DOMAIN }
    case 'claim':
      return { kind, claim: 'groups', value: 'knights' }
    case 'http_method':
      return { kind, is: 'GET' }
  }
}

/** The text a check compares, or null for one with nothing to type. */
function valueOf(criterion: HouseCriterion) {
  switch (criterion.kind) {
    case 'accept':
    case 'authenticated_user':
    case 'http_method':
      return null
    case 'claim':
      return criterion.value
    case 'domain':
    case 'email':
      return criterion.is
  }
}

function withValue(criterion: HouseCriterion, value: string): HouseCriterion {
  switch (criterion.kind) {
    case 'accept':
    case 'authenticated_user':
    case 'http_method':
      return criterion
    case 'claim':
      return { ...criterion, value }
    case 'domain':
    case 'email':
      return { ...criterion, is: value }
  }
}

/** The email picker's choice for an address that isn't anyone's the game knows; the player types it. */
const SOMEONE_ELSE = ''

/** Whose email an email check can pick. The owner isn't listed: their deed already lets them in. */
const peopleWith = () => VISITOR_IDS.map((id) => VISITORS[id])

const valid = (rules: readonly HouseRule[]) =>
  rules.every((rule) =>
    rule.criteria.every((criterion) => {
      const value = valueOf(criterion)

      return value === null || HOUSE_VALUE.test(value)
    }),
  )

const field =
  'rounded border-2 border-panel-edge bg-night-deep px-2 py-1 text-[0.9rem] text-ink focus-visible:border-lens'

const smallButton =
  'rounded border-2 border-panel-edge bg-panel px-2.5 py-1 font-display text-[0.85rem] text-ink hover:border-lens disabled:opacity-50'

const overlay =
  'absolute inset-0 grid items-start justify-items-center overflow-auto bg-[rgb(10_7_22/0.9)] p-3.5'

/** What the desk's Pomerium tab links to: writing a policy, and the open door it replaces. */
const DESK_DOCS: readonly LessonId[] = ['writePolicy', 'publicRoute']

/** The desk: build door rules from blocks, see the PPL they make, and put them on the door. */
export function HouseEditor() {
  const open = useQuest((s) => s.houseEditor)

  if (!open) return null

  return <Editor />
}

function Editor() {
  const identity = useQuest((s) => s.identity)
  const saved = useQuest((s) => s.progress.houseRules)
  const house = useQuest((s) => s.house)

  const [rules, setRules] = useState<readonly HouseRule[]>(() => saved ?? [])
  const locksYouOut = turnsAwayOwner(rules, identity)

  // A house still public with no rules written has nothing to put on the door yet.
  const changed = saved !== null || rules.length > 0

  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const letter = currentLetter()

  const setRule = (index: number, rule: HouseRule) =>
    setRules((current) => current.map((candidate, i) => (i === index ? rule : candidate)))

  const save = async () => {
    setSaving(true)
    setStatus(null)
    const built = await saveDoorRules(rules)
    setSaving(false)

    if (built.ok) quest.closeHouseEditor()
    else setStatus(built.message)
  }

  // Escape closes the desk wherever focus is, even outside the form.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      quest.closeHouseEditor()
    }

    window.addEventListener('keydown', onEscape)

    return () => window.removeEventListener('keydown', onEscape)
  }, [])

  // The form keeps its other keys: typing must not walk the dog or open the menu.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') event.stopPropagation()
  }

  const actions = (
    <div className="mt-auto flex flex-wrap justify-end gap-2 pt-1">
      <button className={smallButton} type="button" onClick={() => quest.closeHouseEditor()}>
        Close
      </button>
      <button
        className={`${smallButton} border-lens`}
        type="button"
        disabled={saving || !changed || !valid(rules) || locksYouOut}
        onClick={() => void save()}
      >
        {saving ? 'The builders are at work…' : 'Put these rules on the door'}
      </button>
    </div>
  )

  const problems = (
    <>
      {!valid(rules) && (
        <p className="m-0 text-[0.85rem] text-deny" role="alert">
          Fill in every check. Emails, domains and groups may only use letters, numbers and @ . _ -
        </p>
      )}
      {locksYouOut && (
        <p className="m-0 text-[0.85rem] text-deny" role="alert">
          A deny rule matches you. A deny always wins, even over your deed, so this door would turn you away.
        </p>
      )}
      {status && (
        <p className="m-0 text-[0.85rem] text-deny" role="alert">
          {status}
        </p>
      )}
    </>
  )

  const kingdom = (
    <div className="flex flex-col gap-3 rounded-tr-lg rounded-b-lg border-3 border-ink bg-night-deep px-4 py-3.5">
      <h2 className="m-0 font-display text-[1.4rem] text-sun" id="desk-title-kingdom">
        Your door rules
      </h2>
      {letter && (
        <p className="m-0 rounded border border-panel-edge bg-panel px-3 py-2 text-[0.9rem]">
          <span className="font-display text-sun">{letter.title}</span> {letter.text}
        </p>
      )}
      <p className="m-0 text-[0.85rem] text-muted">
        Your door lets someone in when any allow rule matches them and no deny rule does. Who might knock:{' '}
        {Object.values(VISITORS)
          .map(
            (visitor) =>
              `${visitor.name} (${visitor.email}${visitor.groups.length ? `, ${visitor.groups.join(', ')}` : ''})`,
          )
          .join(' · ')}
        , and slimes, who never sign in.
      </p>
      {saved === null && (
        <p className="m-0 rounded border-2 border-deny px-3 py-2.5 text-[0.9rem]">
          <span className="font-display text-sun">Wide open</span> Right now your door is public
          (allow_public_unauthenticated_access), so Pomerium lets in everyone, even slimes with no session.
          Putting rules on the door replaces that.
        </p>
      )}
      <p className="m-0 rounded border-2 border-panel-edge px-3 py-2.5 text-[0.9rem]">
        <span className="font-display text-sun">Your deed</span> Whoever holds this house's deed always gets
        in, so you need no rule for yourself. The rules below are for everyone else.
      </p>
      {rules.map((rule, index) => (
        <RuleCard
          key={index}
          rule={rule}
          index={index}
          onChange={(next) => setRule(index, next)}
          onRemove={() => setRules(rules.filter((_, i) => i !== index))}
        />
      ))}
      <div>
        <button
          className={smallButton}
          type="button"
          disabled={rules.length >= HOUSE_LIMITS.rules}
          onClick={() =>
            setRules([...rules, { action: 'allow', match: 'and', criteria: [blank('authenticated_user')] }])
          }
        >
          + Add a rule
        </button>
      </div>
      {problems}
      <p className="m-0 text-[0.85rem] text-muted">
        These rules become a real Pomerium route. See it on the{' '}
        <button className="border-0 bg-transparent p-0 text-lens underline" type="button" onClick={switchTab}>
          In Pomerium
        </button>{' '}
        tab.
      </p>
      {actions}
    </div>
  )

  const pomerium = (
    <div className="flex flex-col gap-2.5 rounded-tr-lg rounded-b-lg border-t-6 border-lens bg-paper px-5 py-[18px] text-paper-ink [&_a]:text-paper-link">
      <h2 className="m-0 text-[1.25rem] font-bold" id="desk-title-pomerium">
        Your house is a route
      </h2>
      <p className="m-0 text-[0.9rem]">
        The game writes your rules into a real route for your house, as its policy. Pomerium lets a request in
        when any allow rule matches and no deny rule does. If no allow rule matches, it says no.
      </p>
      {saved === null && (
        <>
          <p className="m-0 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase">
            The route Pomerium has right now
          </p>
          <pre className="m-0 overflow-x-auto rounded bg-paper-tint px-3 py-2.5 text-[0.8rem] leading-[1.45]">
            {houseRouteYaml(house, null)}
          </pre>
          <p className="m-0 text-[0.9rem]">
            It's public: no policy, so Pomerium lets in every request, signed in or not. Add a rule at the
            desk and the route Pomerium will get appears below.
          </p>
        </>
      )}
      {changed && (
        <>
          <p className="m-0 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase">
            The route Pomerium will get
          </p>
          <pre className="m-0 overflow-x-auto rounded bg-paper-tint px-3 py-2.5 text-[0.8rem] leading-[1.45]">
            {houseRouteYaml(house, rules)}
          </pre>
        </>
      )}
      {problems}
      <ul className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-[0.85rem]">
        {DESK_DOCS.map((lesson) => (
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
        name="desk"
        label="Your door rules"
        showing="desk"
        overlay={overlay}
        role="dialog"
        kingdom={kingdom}
        pomerium={pomerium}
      />
    </div>
  )
}

function RuleCard({
  rule,
  index,
  onChange,
  onRemove,
}: {
  readonly rule: HouseRule
  readonly index: number
  readonly onChange: (rule: HouseRule) => void
  readonly onRemove: (() => void) | undefined
}) {
  const setCriterion = (at: number, criterion: HouseCriterion) =>
    onChange({ ...rule, criteria: rule.criteria.map((candidate, i) => (i === at ? criterion : candidate)) })

  return (
    <fieldset className="m-0 flex flex-col gap-2 rounded border-2 border-panel-edge px-3 py-2.5">
      <legend className="px-1 font-display text-[0.9rem] text-sun">Rule {index + 1}</legend>
      <div className="flex flex-wrap items-center gap-2 text-[0.9rem]">
        <select
          className={field}
          aria-label={`Rule ${index + 1}: allow or deny`}
          value={rule.action}
          onChange={(event) => {
            const action = ACTIONS.find((candidate) => candidate.value === event.target.value)?.value

            if (action) onChange({ ...rule, action })
          }}
        >
          {ACTIONS.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
        </select>
        <span>a visitor who passes</span>
        <select
          className={field}
          aria-label={`Rule ${index + 1}: how its checks combine`}
          value={rule.match}
          onChange={(event) => {
            const match = MATCHES.find((candidate) => candidate.value === event.target.value)?.value

            if (match) onChange({ ...rule, match })
          }}
        >
          {MATCHES.map((match) => (
            <option key={match.value} value={match.value}>
              {match.label}
            </option>
          ))}
        </select>
        {onRemove && (
          <button className={`${smallButton} ml-auto`} type="button" onClick={onRemove}>
            Remove rule
          </button>
        )}
      </div>
      {rule.criteria.map((criterion, at) => (
        <CheckRow
          key={at}
          criterion={criterion}
          label={`Rule ${index + 1}, check ${at + 1}`}
          onChange={(next) => setCriterion(at, next)}
          onRemove={
            rule.criteria.length > 1
              ? () => onChange({ ...rule, criteria: rule.criteria.filter((_, i) => i !== at) })
              : undefined
          }
        />
      ))}
      <div>
        <button
          className={smallButton}
          type="button"
          disabled={rule.criteria.length >= HOUSE_LIMITS.criteria}
          onClick={() => onChange({ ...rule, criteria: [...rule.criteria, blank('email')] })}
        >
          + Add a check
        </button>
      </div>
    </fieldset>
  )
}

function CheckRow({
  criterion,
  label,
  onChange,
  onRemove,
}: {
  readonly criterion: HouseCriterion
  readonly label: string
  readonly onChange: (criterion: HouseCriterion) => void
  readonly onRemove: (() => void) | undefined
}) {
  const value = valueOf(criterion)
  const people = peopleWith()
  const known = criterion.kind === 'email' && people.some((person) => person.email === criterion.is)

  return (
    <div className="flex flex-wrap items-center gap-2 pl-2">
      <select
        className={field}
        aria-label={`${label}: what it checks`}
        value={criterion.kind}
        onChange={(event) => {
          const kind = KINDS.find((candidate) => candidate.kind === event.target.value)?.kind

          if (kind) onChange(blank(kind))
        }}
      >
        {KINDS.map((kind) => (
          <option key={kind.kind} value={kind.kind}>
            {kind.label}
          </option>
        ))}
      </select>
      {criterion.kind === 'http_method' && (
        <select
          className={field}
          aria-label={`${label}: method`}
          value={criterion.is}
          onChange={(event) => onChange({ ...criterion, is: event.target.value === 'POST' ? 'POST' : 'GET' })}
        >
          <option value="GET">GET (look in)</option>
          <option value="POST">POST (knock)</option>
        </select>
      )}
      {criterion.kind === 'email' && (
        <select
          className={field}
          aria-label={`${label}: whose email`}
          value={known ? criterion.is : SOMEONE_ELSE}
          onChange={(event) => onChange({ ...criterion, is: event.target.value })}
        >
          {people.map((person) => (
            <option key={person.email} value={person.email}>
              {person.name} ({person.email})
            </option>
          ))}
          <option value={SOMEONE_ELSE}>someone else…</option>
        </select>
      )}
      {value !== null && !known && (
        <input
          className={`${field} min-w-0 flex-1 ${HOUSE_VALUE.test(value) ? '' : 'border-deny'}`}
          aria-label={`${label}: value`}
          aria-invalid={!HOUSE_VALUE.test(value)}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(event) => onChange(withValue(criterion, event.target.value.trim()))}
        />
      )}
      {onRemove && (
        <button className={smallButton} type="button" aria-label={`Remove ${label}`} onClick={onRemove}>
          ✕
        </button>
      )}
    </div>
  )
}
