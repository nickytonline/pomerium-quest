// The player's house (docs/prd/your-house.md): the desk where they write their door rules, and the
// results of ringing the bell. The rules become a real Pomerium route; nothing here decides access.
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { LESSONS, link } from '../game/content.ts'
import { HOUSE_LIMITS, HOUSE_VALUE, VISITORS, type HouseCriterion, type HouseRule } from '../game/house.ts'
import { callerName, currentLetter, houseRouteYaml, saveDoorRules } from '../game/house-story.ts'
import { policyYaml } from '../game/ppl.ts'
import { quest, useQuest, type VisitResult } from '../game/store.ts'
import { KINGDOM_DOMAIN } from '../game/zones.ts'
import { PolicyLines } from './PolicyLines.tsx'

type Kind = HouseCriterion['kind']

const KINDS: readonly { readonly kind: Kind; readonly label: string }[] = [
  { kind: 'email', label: 'email is' },
  { kind: 'domain', label: 'email domain is' },
  { kind: 'claim', label: 'groups claim has' },
  { kind: 'http_method', label: 'request method is' },
  { kind: 'authenticated_user', label: 'is signed in' },
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

/** A fresh check of each kind; an email check starts as the player's own address. */
function blank(kind: Kind, email: string): HouseCriterion {
  switch (kind) {
    case 'authenticated_user':
      return { kind }
    case 'email':
      return { kind, is: email }
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

/** The desk: build door rules from blocks, see the PPL they make, and put them on the door. */
export function HouseEditor() {
  const open = useQuest((s) => s.houseEditor)

  if (!open) return null

  return <Editor />
}

function Editor() {
  const email = useQuest((s) => s.identity.email)
  const saved = useQuest((s) => s.progress.houseRules)
  const house = useQuest((s) => s.house)

  const [rules, setRules] = useState<readonly HouseRule[]>(
    () => saved ?? [{ action: 'allow', match: 'or', criteria: [blank('email', email)] }],
  )

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

  // The form keeps its keys: typing must not walk the dog or open the menu. Escape closes it.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()

    if (event.key === 'Escape') quest.closeHouseEditor()
  }

  return (
    <div
      className={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="house-editor-title"
      onKeyDown={onKeyDown}
    >
      <div className="flex w-[min(640px,100%)] flex-col gap-3 rounded-md border-3 border-ink bg-night-deep px-4 py-3.5">
        <h2 className="m-0 font-display text-[1.4rem] text-sun" id="house-editor-title">
          Your door rules
        </h2>
        {letter && (
          <p className="m-0 rounded border border-panel-edge bg-panel px-3 py-2 text-[0.9rem]">
            <span className="font-display text-sun">{letter.title}</span> {letter.text}
          </p>
        )}
        <p className="m-0 text-[0.85rem] text-muted">
          Pomerium lets a request in when any allow rule matches and no deny rule does. Visitors:{' '}
          {Object.values(VISITORS)
            .map(
              (visitor) =>
                `${visitor.name} (${visitor.email}${visitor.groups.length ? `, ${visitor.groups.join(', ')}` : ''})`,
            )
            .join(' · ')}
          .
        </p>
        {rules.map((rule, index) => (
          <RuleCard
            key={index}
            rule={rule}
            index={index}
            email={email}
            onChange={(next) => setRule(index, next)}
            onRemove={rules.length > 1 ? () => setRules(rules.filter((_, i) => i !== index)) : undefined}
          />
        ))}
        <div>
          <button
            className={smallButton}
            type="button"
            disabled={rules.length >= HOUSE_LIMITS.rules}
            onClick={() =>
              setRules([
                ...rules,
                { action: 'allow', match: 'and', criteria: [blank('authenticated_user', email)] },
              ])
            }
          >
            + Add a rule
          </button>
        </div>
        <div>
          <p className="mb-1 text-[0.72rem] tracking-[0.08em] text-muted uppercase">
            The policy Pomerium will get
          </p>
          <pre className="m-0 overflow-x-auto rounded border border-panel-edge bg-code-bg px-3 py-2.5 text-[0.8rem] leading-[1.45] text-lens">
            {policyYaml(rules, 0).join('\n')}
          </pre>
          <p className="mt-1.5 mb-0 text-[0.8rem] text-muted">
            The game writes this into a real route for your house:{' '}
            <code className="wrap-anywhere">{house?.path ?? '/zones/home/…'}</code>.{' '}
            <a href={link('writePolicy').href} target="_blank" rel="noreferrer">
              Docs: {LESSONS.writePolicy.link.label} ↗
            </a>
          </p>
        </div>
        {!valid(rules) && (
          <p className="m-0 text-[0.85rem] text-deny" role="alert">
            Fill in every check. Emails, domains and groups may only use letters, numbers and @ . _ -
          </p>
        )}
        {status && (
          <p className="m-0 text-[0.85rem] text-deny" role="alert">
            {status}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button className={smallButton} type="button" onClick={() => quest.closeHouseEditor()}>
            Close
          </button>
          <button
            className={`${smallButton} border-lens`}
            type="button"
            disabled={saving || !valid(rules)}
            onClick={() => void save()}
          >
            {saving ? 'The builders are at work…' : 'Put these rules on the door'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RuleCard({
  rule,
  index,
  email,
  onChange,
  onRemove,
}: {
  readonly rule: HouseRule
  readonly index: number
  readonly email: string
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
          email={email}
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
          onClick={() => onChange({ ...rule, criteria: [...rule.criteria, blank('email', '')] })}
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
  email,
  onChange,
  onRemove,
}: {
  readonly criterion: HouseCriterion
  readonly label: string
  readonly email: string
  readonly onChange: (criterion: HouseCriterion) => void
  readonly onRemove: (() => void) | undefined
}) {
  const value = valueOf(criterion)

  return (
    <div className="flex flex-wrap items-center gap-2 pl-2">
      <select
        className={field}
        aria-label={`${label}: what it checks`}
        value={criterion.kind}
        onChange={(event) => {
          const kind = KINDS.find((candidate) => candidate.kind === event.target.value)?.kind

          if (kind) onChange(blank(kind, email))
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
      {value !== null && (
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

const STATUS_TEXT = new Map([
  [200, 'let in'],
  [401, 'no session: turned away'],
  [403, 'refused'],
])

/** Who knocked when the bell rang, what Pomerium answered, and what the letter wanted. */
export function VisitsScreen() {
  const visits = useQuest((s) => s.visits)
  const house = useQuest((s) => s.house)
  const rules = useQuest((s) => s.progress.houseRules)

  if (!visits) return null

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      quest.closeVisits()
    }
  }

  return (
    <div
      className={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="visits-title"
      onKeyDown={onKeyDown}
    >
      <div className="flex w-[min(640px,100%)] flex-col gap-3 rounded-md border-3 border-ink bg-night-deep px-4 py-3.5">
        <h2
          className={`m-0 font-display text-[1.4rem] ${visits.solved ? 'text-allow' : 'text-sun'}`}
          id="visits-title"
        >
          {visits.solved ? 'Letter answered!' : 'Who came to your door'}
        </h2>
        <p className="m-0">{visits.story}</p>
        {visits.note && <p className="m-0 text-deny">{visits.note}</p>}
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {visits.results.map((result, i) => (
            <Visit key={i} result={result} />
          ))}
        </ul>
        <details className="rounded border border-panel-edge bg-panel px-3 py-2">
          <summary className="cursor-pointer font-display text-[0.9rem]">
            Your door as a Pomerium route
          </summary>
          <pre className="mt-2 mb-0 overflow-x-auto text-[0.8rem] text-lens">
            {houseRouteYaml(house, rules)}
          </pre>
        </details>
        <div className="flex justify-end">
          <button
            className="rounded border-2 border-ink bg-panel px-3.5 py-2 font-display text-ink hover:border-lens"
            type="button"
            autoFocus
            onClick={() => quest.closeVisits()}
          >
            Back to the house
          </button>
        </div>
      </div>
    </div>
  )
}

function Visit({ result }: { readonly result: VisitResult }) {
  const allowed = result.status === 200
  const right = result.wanted === undefined || result.wanted === allowed

  const verdict =
    STATUS_TEXT.get(result.status) ?? (result.status === 0 ? 'got lost' : `status ${result.status}`)

  return (
    <li className={`rounded border-2 px-3 py-2 ${right ? 'border-panel-edge' : 'border-deny'}`}>
      <p className="m-0 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display">{callerName(result.who)}</span>
        <code className="text-[0.8rem] text-muted">{result.method}</code>
        <span className={allowed ? 'text-allow' : 'text-deny'}>
          {result.status} {verdict}
        </span>
        {result.wanted !== undefined && (
          <span className="ml-auto text-[0.85rem] text-muted">
            {right
              ? '✓ as the letter asked'
              : `✗ the letter wants them ${result.wanted ? 'let in' : 'kept out'}`}
          </span>
        )}
      </p>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[0.8rem] text-muted">How your rules decided</summary>
        <div className="mt-1.5 text-paper-ink">
          <PolicyLines lines={result.lines} />
        </div>
      </details>
    </li>
  )
}
