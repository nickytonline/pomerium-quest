// A small PPL evaluator for the criteria the game uses. The real decision comes from
// Pomerium; this evaluator only explains it (which line passed, which failed).
import type { Criterion, PolicyRule, Zone } from './zones.ts'

export interface Identity {
  readonly authenticated: boolean
  readonly email: string
  /** The `groups` claim from the identity provider, as carried in the session. */
  readonly groups: readonly string[]
}

export interface RequestInfo {
  readonly method: 'GET' | 'POST'
  readonly path: string
}

export interface EvalLine {
  readonly text: string
  /** Set on criteria only; the allow and and/or lines around them are structure, not checks. */
  readonly ok?: boolean
  readonly actual?: string
}

/** Whose request the explanation describes: the player's own, or someone the player is watching. */
export type Viewpoint = 'your' | 'their'

export interface Decision {
  readonly allow: boolean
  readonly lines: readonly EvalLine[]
}

interface Check {
  readonly ok: boolean
  readonly actual: string
}

const pad = (n: number) => ' '.repeat(n)

/** The YAML lines Pomerium reads for one criterion. */
function criterionYaml(node: Criterion): readonly string[] {
  switch (node.kind) {
    case 'accept':
      return ['accept: true']
    case 'authenticated_user':
      return ['authenticated_user: true']
    case 'claim':
      return [`claim/${node.claim}: ${node.value}`]
    case 'domain':
    case 'email':
    case 'http_method':
      return [`${node.kind}:`, `  is: ${node.is}`]
  }
}

/** The same criterion on one line, for the denial screen. */
function criterionLabel(node: Criterion): string {
  switch (node.kind) {
    case 'accept':
      return 'accept: true'
    case 'authenticated_user':
      return 'authenticated_user: true'
    case 'claim':
      return `claim/${node.claim}: ${node.value}`
    case 'domain':
    case 'email':
    case 'http_method':
      return `${node.kind}: { is: ${node.is} }`
  }
}

/** A route's policy as YAML lines, starting at `indent`. */
export function policyYaml(policy: readonly PolicyRule[], indent: number): string[] {
  return policy.flatMap((rule) => [
    `${pad(indent)}- ${rule.action}:`,
    `${pad(indent + 4)}${rule.match}:`,
    ...rule.criteria.flatMap((criterion) => {
      const [first = '', ...rest] = criterionYaml(criterion)

      return [`${pad(indent + 6)}- ${first}`, ...rest.map((line) => `${pad(indent + 8)}${line}`)]
    }),
  ])
}

function check(node: Criterion, id: Identity, req: RequestInfo, whose: Viewpoint): Check {
  const domain = id.email.split('@')[1] ?? ''

  switch (node.kind) {
    case 'accept':
      return { ok: true, actual: 'every request matches' }
    case 'authenticated_user':
      return {
        ok: id.authenticated,
        actual: id.authenticated ? `${whose === 'your' ? 'you are' : 'they are'} signed in` : 'no session',
      }
    case 'domain':
      return { ok: domain === node.is, actual: `${whose} domain: ${domain || 'none'}` }
    case 'email':
      return { ok: id.email === node.is, actual: `${whose} email: ${id.email || 'none'}` }
    case 'http_method':
      return { ok: req.method === node.is, actual: `this request: ${req.method}` }
    case 'claim': {
      const values = node.claim === 'groups' ? id.groups : [id.email]

      return { ok: values.includes(node.value), actual: `${whose} ${node.claim}: [${values.join(', ')}]` }
    }
  }
}

/** How each operator combines its criteria. */
const COMBINE: Record<PolicyRule['match'], (results: readonly boolean[]) => boolean> = {
  and: (results) => results.every(Boolean),
  or: (results) => results.some(Boolean),
  not: (results) => !results.some(Boolean),
}

interface RuleResult extends Decision {
  readonly rule: PolicyRule
}

function evaluateRule(rule: PolicyRule, id: Identity, req: RequestInfo, whose: Viewpoint): RuleResult {
  const checks = rule.criteria.map((criterion) => ({ criterion, ...check(criterion, id, req, whose) }))

  return {
    rule,
    allow: COMBINE[rule.match](checks.map((c) => c.ok)),
    lines: [
      { text: `- ${rule.action}:` },
      { text: `    ${rule.match}:` },
      ...checks.map((c) => ({ text: `      - ${criterionLabel(c.criterion)}`, ok: c.ok, actual: c.actual })),
    ],
  }
}

/** Allowed when an allow rule matches and no deny rule does; with no matching allow rule, Pomerium denies. */
/** Anything with a policy: a zone, or the player's house. */
export type Policed = Pick<Zone, 'policy'>

export function decide(zone: Policed, id: Identity, req: RequestInfo, whose: Viewpoint = 'your'): Decision {
  const rules = zone.policy.map((rule) => evaluateRule(rule, id, req, whose))
  const matched = (action: PolicyRule['action']) => rules.some((r) => r.rule.action === action && r.allow)

  return { allow: matched('allow') && !matched('deny'), lines: rules.flatMap((rule) => rule.lines) }
}

/** A criterion as the structure Pomerium reads; JSON is YAML, so it can go straight into a config. */
function criterionDocument(node: Criterion) {
  switch (node.kind) {
    case 'accept':
      return { accept: true }
    case 'authenticated_user':
      return { authenticated_user: true }
    case 'claim':
      return { [`claim/${node.claim}`]: node.value }
    case 'domain':
    case 'email':
    case 'http_method':
      return { [node.kind]: { is: node.is } }
  }
}

/** A route policy as the structure Pomerium reads. */
export const policyDocument = (rules: readonly PolicyRule[]) =>
  rules.map((rule) => ({ [rule.action]: { [rule.match]: rule.criteria.map(criterionDocument) } }))

/** Route config as YAML, the way it appears in the Pomerium config file. */
export function routeYaml(zone: Zone, host: string, upstream: string): string {
  return [
    `- from: https://${host}`,
    `  prefix: ${zone.prefix}`,
    `  to: ${upstream}`,
    `  pass_identity_headers: true`,
    `  policy:`,
    ...policyYaml(zone.policy, 4),
  ].join('\n')
}
