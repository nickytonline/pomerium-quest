// A small PPL evaluator for the criteria the game uses. In Pomerium mode the real decision
// comes from Pomerium; this evaluator only explains it (which line passed, which failed).
// In simulated mode it is the decision.
import type { PPLNode, Zone } from './zones.ts'

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
  readonly ok: boolean
  readonly actual?: string
}

export interface Decision {
  readonly allow: boolean
  readonly lines: readonly EvalLine[]
}

interface Evaluated {
  readonly ok: boolean
  readonly lines: readonly EvalLine[]
}

type Operator = Extract<PPLNode, { kind: 'and' | 'or' }>

type Criterion = Exclude<PPLNode, Operator>

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

export function pplYaml(node: PPLNode, indent: number): string[] {
  if (node.kind === 'and' || node.kind === 'or') {
    const items = node.rules.flatMap((rule) => {
      const [first = '', ...rest] = pplYaml(rule, indent + 4)

      return [`${pad(indent + 2)}- ${first.trimStart()}`, ...rest]
    })

    return [`${pad(indent)}${node.kind}:`, ...items]
  }

  return criterionYaml(node).map((line) => `${pad(indent)}${line}`)
}

interface Check {
  readonly ok: boolean
  readonly actual: string
}

function check(node: Criterion, id: Identity, req: RequestInfo): Check {
  const domain = id.email.split('@')[1] ?? ''

  switch (node.kind) {
    case 'authenticated_user':
      return { ok: id.authenticated, actual: id.authenticated ? 'you are signed in' : 'no session' }
    case 'domain':
      return { ok: domain === node.is, actual: `your domain: ${domain || 'none'}` }
    case 'email':
      return { ok: id.email === node.is, actual: `your email: ${id.email || 'none'}` }
    case 'http_method':
      return { ok: req.method === node.is, actual: `this request: ${req.method}` }
    case 'claim': {
      const values = node.claim === 'groups' ? id.groups : [id.email]

      return { ok: values.includes(node.value), actual: `your ${node.claim}: [${values.join(', ')}]` }
    }
  }
}

function evaluate(node: PPLNode, id: Identity, req: RequestInfo, indent: number): Evaluated {
  if (node.kind === 'and' || node.kind === 'or') {
    const parts = node.rules.map((rule) => evaluate(rule, id, req, indent + 4))
    const ok = node.kind === 'and' ? parts.every((part) => part.ok) : parts.some((part) => part.ok)

    const children = parts.flatMap((part) => {
      const [first, ...rest] = part.lines

      return first ? [{ ...first, text: `${pad(indent + 2)}- ${first.text.trimStart()}` }, ...rest] : []
    })

    return { ok, lines: [{ text: `${pad(indent)}${node.kind}:`, ok }, ...children] }
  }

  const { ok, actual } = check(node, id, req)

  return { ok, lines: [{ text: `${pad(indent)}${criterionLabel(node)}`, ok, actual }] }
}

export function decide(zone: Zone, id: Identity, req: RequestInfo): Decision {
  const ev = evaluate(zone.policy.allow, id, req, 2)

  return { allow: ev.ok, lines: [{ text: 'allow:', ok: ev.ok }, ...ev.lines] }
}

/** Route config as YAML, the way it appears in the Pomerium config file. */
export function routeYaml(zone: Zone, host: string, upstream: string): string {
  return [
    `- from: https://${host}`,
    `  prefix: ${zone.prefix}`,
    `  to: ${upstream}`,
    `  pass_identity_headers: true`,
    `  policy:`,
    `    allow:`,
    ...pplYaml(zone.policy.allow, 6),
  ].join('\n')
}
