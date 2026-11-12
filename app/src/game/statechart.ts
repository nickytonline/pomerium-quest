// Draws an XState machine as a Mermaid state diagram, so the README's charts come from the machines
// themselves. `scripts/statecharts.ts` writes them into the README; statechart.test.ts fails if they drift.
import type { AnyStateMachine, AnyStateNode, AnyTransitionDefinition } from 'xstate'

interface Edge {
  readonly from: AnyStateNode
  readonly to: AnyStateNode
  readonly label: string
}

/** A Mermaid-safe id for a state, unique across the whole machine. */
const idOf = (node: AnyStateNode) => node.path.join('_')

type Guard = AnyTransitionDefinition['guard']

type Delay = AnyStateNode['after'][number]['delay']

/** A named guard reads as a condition on the edge; an inline one has no name to show. */
function guardName(guard: Guard) {
  if (guard === undefined || guard instanceof Function) return undefined

  return guard instanceof Object ? guard.type : guard
}

function label(event: string, guard: Guard) {
  const name = guardName(guard)

  return name ? `${event} [${name}]`.trim() : event
}

/** A number is milliseconds; a string names a delay the machine sets up, like the night's `dawn`. */
function formatDelay(delay: Delay) {
  if (delay instanceof Function) return 'after a delay'

  return Number.isFinite(delay) ? `after ${delay} ms` : `after ${delay}`
}

function edgesOf(node: AnyStateNode): Edge[] {
  const edges: Edge[] = []

  const add = (targets: readonly AnyStateNode[] | undefined, text: string) => {
    // A state sending itself back into one of its own children, like a reset, draws as an unreadable loop.
    for (const to of targets ?? [])
      if (to === node || !isInside(to, node)) edges.push({ from: node, to, label: text })
  }

  for (const [event, transitions] of Object.entries(node.on)) {
    // Delayed transitions show up here under an internal event name; `after` below draws them.
    if (event.startsWith('xstate.after')) continue

    for (const t of transitions) add(t.target, label(event, t.guard))
  }

  for (const t of node.always ?? []) add(t.target, label('', t.guard) || 'always')

  for (const t of node.after) add(t.target, formatDelay(t.delay))

  for (const child of Object.values(node.states)) edges.push(...edgesOf(child))

  return edges
}

/** Whether `node` is `ancestor` or one of the states inside it. */
const isInside = (node: AnyStateNode, ancestor: AnyStateNode) =>
  node.path.slice(0, ancestor.path.length).join('.') === ancestor.path.join('.')

/** The deepest state that contains both ends of an edge, where Mermaid needs the edge written. */
function commonParent(a: AnyStateNode, b: AnyStateNode) {
  for (let parent = a.parent; parent; parent = parent.parent) {
    if (isInside(b, parent) && b !== parent) return parent
  }

  return a.machine.root
}

function body(node: AnyStateNode, edges: readonly Edge[], indent: string): string[] {
  const lines: string[] = []
  const children = Object.values(node.states)

  // Mermaid's `--` between parallel regions fails on regions with nested states, so regions sit side by side.
  for (const child of children) {
    const id = idOf(child)

    lines.push(`${indent}state "${child.key}" as ${id}`)

    if (Object.keys(child.states).length > 0) {
      lines.push(`${indent}state ${id} {`, ...body(child, edges, `${indent}  `), `${indent}}`)
    }
  }

  const initial = node.initial?.target[0]

  if (initial) lines.push(`${indent}[*] --> ${idOf(initial)}`)

  for (const child of children) if (child.type === 'final') lines.push(`${indent}${idOf(child)} --> [*]`)

  for (const edge of edges) {
    if (commonParent(edge.from, edge.to) !== node) continue

    lines.push(`${indent}${idOf(edge.from)} --> ${idOf(edge.to)}: ${edge.label}`)
  }

  return lines
}

/** The machine as a Mermaid `stateDiagram-v2`: states, initial states, and every transition with a target. */
export function toMermaid(machine: AnyStateMachine) {
  const edges = edgesOf(machine.root)

  return ['stateDiagram-v2', ...body(machine.root, edges, '  ')].join('\n')
}

/** Each machine's chart in the README sits between `<!-- statechart:<name> -->` and `<!-- /statechart:<name> -->`. */
export function withChart(readme: string, name: string, machine: AnyStateMachine) {
  const open = `<!-- statechart:${name} -->`
  const close = `<!-- /statechart:${name} -->`
  const start = readme.indexOf(open)
  const end = readme.indexOf(close)

  if (start < 0 || end < start) throw new Error(`The README has no ${open} … ${close} markers`)

  const chart = ['```mermaid', toMermaid(machine), '```'].join('\n')

  return `${readme.slice(0, start + open.length)}\n\n${chart}\n\n${readme.slice(end)}`
}
