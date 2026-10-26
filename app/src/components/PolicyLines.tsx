import type { EvalLine } from '../game/ppl.ts'

/** The rule Pomerium evaluated, line by line; only criteria carry a ✓ or ✗. */
export function PolicyLines({ lines }: { readonly lines: readonly EvalLine[] }) {
  return (
    <div className="overflow-x-auto rounded bg-paper-tint px-2.5 py-2">
      <p className="mb-1 text-[0.72rem] tracking-[0.08em] text-paper-muted uppercase">Policy evaluation</p>
      {lines.map((line, i) => (
        <div
          key={i}
          className={`grid grid-cols-[1.2em_max-content_1fr] items-baseline gap-2 text-[0.8rem] ${line.ok === false ? 'text-[#c2183a]' : ''}`}
        >
          <span className={line.ok ? 'text-[#15803d]' : ''}>
            {line.ok === undefined ? '' : line.ok ? '✓' : '✗'}
          </span>
          <code className="whitespace-pre">{line.text}</code>
          {line.actual && <span className="text-[0.75rem] text-paper-muted">{line.actual}</span>}
        </div>
      ))}
    </div>
  )
}
