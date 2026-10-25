// A small PPL evaluator for the criteria the game uses. In Pomerium mode the real decision
// comes from Pomerium; this evaluator only explains it (which line passed, which failed).
// In simulated mode it is the decision.
import type { AllowRule, Criterion, Zone } from './zones.ts'

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
export function policyYaml(policy: readonly AllowRule[], indent: number): string[] {
  return policy.flatMap((rule) => [
    `${pad(indent)}- allow:`,
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

function evaluateRule(rule: AllowRule, id: Identity, req: RequestInfo, whose: Viewpoint): Decision {
  const checks = rule.criteria.map((criterion) => ({ criterion, ...check(criterion, id, req, whose) }))
  const ok = rule.match === 'and' ? checks.every((c) => c.ok) : checks.some((c) => c.ok)

  return {
    allow: ok,
    lines: [
      { text: '- allow:' },
      { text: `    ${rule.match}:` },
      ...checks.map((c) => ({ text: `      - ${criterionLabel(c.criterion)}`, ok: c.ok, actual: c.actual })),
    ],
  }
}

/** Allowed when any allow rule matches; with no matching rule, Pomerium denies. */
export function decide(zone: Zone, id: Identity, req: RequestInfo, whose: Viewpoint = 'your'): Decision {
  const rules = zone.policy.map((rule) => evaluateRule(rule, id, req, whose))

  return { allow: rules.some((rule) => rule.allow), lines: rules.flatMap((rule) => rule.lines) }
}

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
