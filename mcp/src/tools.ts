// The owl's errands, as MCP tools. Pomerium decides whether a call gets here at all (the route's policy
// can refuse the whole route, or tools by name); a tool only checks that the call really came through
// Pomerium, then acts for the player Pomerium signed in. Nothing a call says about who is asking is trusted.
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { GROUPS } from '../../app/src/game/groups.ts'
import { OWL_ERRANDS, OWL_TOOLS, type OwlTool } from '../../app/src/game/owl.ts'
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

/** The errand that ends in a letter to the Oracle, and the group it asks him for. */
const LETTERS = { [OWL_TOOLS.deliverLetter]: GROUPS.keyholders } as const

/**
 * Registers the owl's tools for one request. `verified` is who Pomerium says is calling; without it every
 * tool refuses, since a call that skipped Pomerium has no one to act for.
 */
export function registerTools(server: McpServer, verified: Verified, grant: Grant): void {
  const run = (tool: OwlTool, errand: (caller: Caller) => Promise<Answer> | Answer) => {
    const annotations = { readOnlyHint: !(tool in LETTERS), idempotentHint: true, openWorldHint: false }

    server.registerTool(tool, { ...OWL_ERRANDS[tool], annotations }, async () => {
      if (!verified.ok) return failure(verified.reason)

      try {
        const result = await errand(verified.caller)
        logger.info({ tool, email: verified.caller.email }, 'tool called')

        return answer(result)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error({ tool, reason }, 'tool failed')

        return failure(reason)
      }
    })
  }

  run(OWL_TOOLS.whoami, (caller) => ({ email: caller.email, groups: caller.groups }))
  run(OWL_TOOLS.ringBell, (caller) => ({ rang: true, heardBy: caller.email }))
  run(OWL_TOOLS.scoutGrounds, () => ({
    spotted: 'a white owl, alone and far from any perch',
    where: 'among the trees in the south-east corner of the grounds',
  }))

  run(OWL_TOOLS.deliverLetter, async (caller) => {
    const group = LETTERS[OWL_TOOLS.deliverLetter]
    await grant(caller.email, group)

    return { granted: group, to: caller.email, refreshRequired: true }
  })

  // The Aviary's route denies every open_ tool, so these only answer a caller that skipped its policy.
  // They do nothing either way.
  run(OWL_TOOLS.openVault, () => ({ opened: false, reason: 'the vault has no lock an owl can turn' }))
  run(OWL_TOOLS.openCages, () => ({ opened: false, reason: 'the cages stay shut' }))
}
