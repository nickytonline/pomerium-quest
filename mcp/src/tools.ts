// The owl's errands, as MCP tools. Pomerium decides whether a call gets here at all (the route's policy
// can refuse a whole route, or one tool by name); a tool only checks that the call really came through
// Pomerium, then acts for the player Pomerium signed in. Nothing a call says about who is asking is trusted.
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { GROUPS } from '../../app/src/game/groups.ts'
import { OWL_TOOLS, type OwlTool } from '../../app/src/game/owl.ts'
import type { Caller, Verified } from './identity.ts'
import { logger } from './logger.ts'
import type { Grant } from './oracle.ts'

/** What a tool sends back: plain JSON, also given as text for clients that only read text. */
type Answer = { readonly [key: string]: string | boolean | readonly string[] }

const answer = (data: Answer): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
})

const failure = (error: string): CallToolResult => ({ ...answer({ error }), isError: true })

/** The errands that end in a letter to the Oracle, and the group each one asks him for. */
const LETTERS = {
  [OWL_TOOLS.deliverLetter]: GROUPS.falconers,
  [OWL_TOOLS.openVault]: GROUPS.keyholders,
} as const

const DESCRIPTIONS: Record<OwlTool, { readonly title: string; readonly description: string }> = {
  [OWL_TOOLS.whoami]: {
    title: 'Who am I?',
    description: 'Reads back who the owl is flying for: the email and groups in your Pomerium session.',
  },
  [OWL_TOOLS.ringBell]: {
    title: 'Ring the bell',
    description: 'Flies up to the bell tower, where no dog can climb, and rings the bell.',
  },
  [OWL_TOOLS.deliverLetter]: {
    title: 'Deliver the letter',
    description: `Carries the Falconer's letter to the Oracle, who adds you to the ${GROUPS.falconers} group.`,
  },
  [OWL_TOOLS.openVault]: {
    title: 'Open the vault',
    description: `Asks the Oracle to add you to the ${GROUPS.keyholders} group, which the vault's guard checks.`,
  },
}

/**
 * Registers the owl's tools for one request. `verified` is who Pomerium says is calling; without it every
 * tool refuses, since a call that skipped Pomerium has no one to act for.
 */
export function registerTools(server: McpServer, verified: Verified, grant: Grant): void {
  const run = (tool: OwlTool, errand: (caller: Caller) => Promise<Answer> | Answer) => {
    const annotations = { readOnlyHint: !(tool in LETTERS), idempotentHint: true, openWorldHint: false }

    server.registerTool(tool, { ...DESCRIPTIONS[tool], annotations }, async () => {
      if (!verified.ok) return failure(verified.reason)

      try {
        const result = await errand(verified.caller)
        logger.info({ tool, roost: verified.caller.roost, email: verified.caller.email }, 'tool called')

        return answer(result)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error({ tool, reason }, 'tool failed')

        return failure(reason)
      }
    })
  }

  const letter = (tool: keyof typeof LETTERS) =>
    run(tool, async (caller) => {
      await grant(caller.email, LETTERS[tool])

      return { granted: LETTERS[tool], to: caller.email, refreshRequired: true }
    })

  run(OWL_TOOLS.whoami, (caller) => ({ email: caller.email, groups: caller.groups, roost: caller.roost }))
  run(OWL_TOOLS.ringBell, (caller) => ({ rang: true, heardBy: caller.email }))
  letter(OWL_TOOLS.deliverLetter)
  letter(OWL_TOOLS.openVault)
}
