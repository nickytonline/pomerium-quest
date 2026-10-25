// A small PPL evaluator for the criteria the game uses. In Pomerium mode the real decision
// comes from Pomerium; this evaluator only explains it (which line passed, which failed).
// In simulated mode it is the decision.
import type { PPLNode, Zone } from './zones.ts'

export interface Identity {
  authenticated: boolean
  email: string
  claims: Record<string, unknown>
}

export interface RequestInfo {
  method: string
  path: string
}

export interface EvalLine {
  text: string
  ok: boolean
  actual?: string
}

export interface Decision {
  allow: boolean
  lines: EvalLine[]
}

interface Evaluated {
  ok: boolean
  lines: EvalLine[]
}

const pad = (n: number) => ' '.repeat(n)

function claimValues(identity: Identity, name: string): string[] {
  const value = identity.claims[name]
  if (Array.isArray(value)) return value.map(String)
  if (value === undefined || value === null) return []
  return [String(value)]
}

function evaluate(node: PPLNode, id: Identity, req: RequestInfo, indent: number): Evaluated {
  const [key, value] = Object.entries(node)[0] as [string, unknown]
  if (key === 'and' || key === 'or') {
    const parts = (value as PPLNode[]).map(child => {
      const ev = evaluate(child, id, req, indent + 4)
      ev.lines[0] = { ...ev.lines[0], text: `${pad(indent + 2)}- ${ev.lines[0].text.trimStart()}` }
      return ev
    })
    const ok = key === 'and' ? parts.every(p => p.ok) : parts.some(p => p.ok)
    return { ok, lines: [{ text: `${pad(indent)}${key}:`, ok }, ...parts.flatMap(p => p.lines)] }
  }
  const leaf = (ok: boolean, text: string, actual: string): Evaluated => ({
    ok,
    lines: [{ text: `${pad(indent)}${text}`, ok, actual }],
  })
  const domain = id.email.split('@')[1] ?? ''
  switch (key) {
    case 'authenticated_user':
      return leaf(id.authenticated, 'authenticated_user: true', id.authenticated ? 'you are signed in' : 'no session')
    case 'domain': {
      const want = (value as { is: string }).is
      return leaf(domain === want, `domain: { is: ${want} }`, `your domain: ${domain || 'none'}`)
    }
    case 'email': {
      const want = (value as { is: string }).is
      return leaf(id.email === want, `email: { is: ${want} }`, `your email: ${id.email || 'none'}`)
    }
    case 'http_method': {
      const want = (value as { is: string }).is
      return leaf(req.method === want, `http_method: { is: ${want} }`, `this request: ${req.method}`)
    }
    default: {
      if (key.startsWith('claim/')) {
        const name = key.slice('claim/'.length)
        const have = claimValues(id, name)
        return leaf(have.includes(String(value)), `${key}: ${value}`, `your ${name}: [${have.join(', ')}]`)
      }
      throw new Error(`unsupported PPL criterion ${key}`)
    }
  }
}

export function decide(zone: Zone, id: Identity, req: RequestInfo): Decision {
  const ev = evaluate(zone.policy.allow, id, req, 2)
  return { allow: ev.ok, lines: [{ text: 'allow:', ok: ev.ok }, ...ev.lines] }
}

/** Route config as YAML, the way it appears in the Pomerium config file. */
export function routeYaml(zone: Zone, host: string, upstream: string): string {
  const lines = [
    `- from: https://${host}`,
    `  prefix: ${zone.prefix}`,
    `  to: ${upstream}`,
    `  pass_identity_headers: true`,
    `  policy:`,
    `    allow:`,
    ...pplYaml(zone.policy.allow, 6),
  ]
  return lines.join('\n')
}

export function pplYaml(node: PPLNode, indent: number): string[] {
  const [key, value] = Object.entries(node)[0] as [string, unknown]
  if (key === 'and' || key === 'or') {
    return [
      `${pad(indent)}${key}:`,
      ...(value as PPLNode[]).flatMap(child => {
        const lines = pplYaml(child, indent + 4)
        lines[0] = `${pad(indent + 2)}- ${lines[0].trimStart()}`
        return lines
      }),
    ]
  }
  if (value === true || typeof value === 'string') return [`${pad(indent)}${key}: ${value}`]
  const [op, operand] = Object.entries(value as Record<string, string>)[0]
  return [`${pad(indent)}${key}:`, `${pad(indent + 2)}${op}: ${operand}`]
}
