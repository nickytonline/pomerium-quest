// The owl's errands, as MCP tools. Pomerium decides whether a call gets here at all (the route's policy
// can refuse the whole route, or tools by name); a tool only checks that the call really came through
// Pomerium, then acts for the player Pomerium signed in. Nothing a call says about who is asking is trusted.
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { GROUPS } from '../../app/src/game/groups.ts'
import { z } from 'zod'
import { MOCHIS_OWL, OWL_ERRANDS, OWL_TOOLS, SIGHTINGS, type OwlTool } from '../../app/src/game/owl.ts'
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

/** The errands that change something, so a client knows they are more than a look. */
const CHANGES: ReadonlySet<OwlTool> = new Set([OWL_TOOLS.deliverLetter, OWL_TOOLS.openCage])

/**
 * Registers the owl's tools for one request. `verified` is who Pomerium says is calling; without it every
 * tool refuses, since a call that skipped Pomerium has no one to act for.
 */
export function registerTools(server: McpServer, verified: Verified, grant: Grant): void {
  const annotated = (tool: OwlTool) => ({
    ...OWL_ERRANDS[tool],
    annotations: { readOnlyHint: !CHANGES.has(tool), idempotentHint: true, openWorldHint: false },
  })

  const act = async (tool: OwlTool, errand: (caller: Caller) => Promise<Answer> | Answer) => {
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
  }

  const run = (tool: OwlTool, errand: (caller: Caller) => Promise<Answer> | Answer) => {
    server.registerTool(tool, annotated(tool), () => act(tool, errand))
  }

  run(OWL_TOOLS.whoami, (caller) => ({ email: caller.email, groups: caller.groups }))
  run(OWL_TOOLS.ringBell, (caller) => ({ rang: true, heardBy: caller.email }))
  // The one errand that takes an argument. Where Mochi's owl is depends on how far the player has got,
  // which only the game knows, so the call says; left out, the owl is still lost.
  server.registerTool(
    OWL_TOOLS.scoutGrounds,
    {
      ...annotated(OWL_TOOLS.scoutGrounds),
      inputSchema: z.object({
        mochisOwl: z
          .enum(Object.values(MOCHIS_OWL))
          .optional()
          .describe("Where Mochi's owl is in the caller's game. Left out, it is still lost."),
      }),
    },
    ({ mochisOwl }) => act(OWL_TOOLS.scoutGrounds, () => SIGHTINGS[mochisOwl ?? MOCHIS_OWL.lost]),
  )

  run(OWL_TOOLS.deliverLetter, async (caller) => {
    const group = LETTERS[OWL_TOOLS.deliverLetter]
    await grant(caller.email, group)

    return { granted: group, to: caller.email, refreshRequired: true }
  })

  // The Aviary's route denies every open_ tool to all but a distinguished falconer's owl, so only such an
  // owl's call gets here. The cage holds the stray owl the keeper took in; the vault opens for no owl at all.
  run(OWL_TOOLS.openVault, () => ({ opened: false, reason: 'the vault has no lock an owl can turn' }))
  run(OWL_TOOLS.openCage, (caller) => ({ opened: true, openedFor: caller.email, freed: 'a white owl' }))
}
