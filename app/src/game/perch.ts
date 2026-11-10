// What a perch sends and hears. Sending the owl from a perch is a tool call: the browser asks the game
// server (through Pomerium's /zones/perch route), and the server makes the real MCP request to the
// Aviary, through Pomerium again, with the token Pomerium gave it for the player.
import { GROUPS } from './groups.ts'
import { TOWNSFOLK_DOMAIN, type Visitor } from './house.ts'
import type { MochisOwlAt, OwlTool } from './owl.ts'

/**
 * The Falconer has a real account at the Oracle, like the townsfolk who visit houses, so an errand their owl
 * runs is a real tool call that Pomerium checks. They hold every group the perch and the Aviary ask for, and
 * the one no player holds: distinguished falconers, whose owls may call the open_ tools.
 */
export const FALCONER: Visitor = {
  name: 'the Falconer',
  email: `falconer@${TOWNSFOLK_DOMAIN}`,
  groups: [GROUPS.citizens, GROUPS.knights, GROUPS.scholars, GROUPS.falconers, GROUPS.distinguishedFalconers],
}

/** What a tool call carries besides the tool's name. Only the scouting errand takes anything. */
export type OwlArgs = { readonly mochisOwl?: MochisOwlAt | undefined }

/** What the owl is sent to do: list the Aviary's tools, or call one. */
export type OwlCall =
  | { readonly method: 'tools/list' }
  | { readonly method: 'tools/call'; readonly tool: OwlTool; readonly args?: OwlArgs | undefined }

// Type aliases (not interfaces) so a flight stays assignable to the server's Json response type.
export type ToolInfo = {
  readonly name: string
  readonly title: string | null
  readonly description: string | null
}

/** How the Aviary answered, read from the MCP response. */
export type OwlOutcome =
  | { readonly kind: 'tools'; readonly tools: readonly ToolInfo[] }
  /** The tool ran. `failed` is the tool's own error (isError), not a refusal by Pomerium. */
  | { readonly kind: 'result'; readonly text: string; readonly failed: boolean }
  /** Pomerium's policy refused the request: it answers an MCP request with a JSON-RPC error. */
  | { readonly kind: 'refused'; readonly message: string; readonly requestId: string | null }
  /** Pomerium found no session behind the token. */
  | { readonly kind: 'signin' }
  | { readonly kind: 'error'; readonly message: string }

/** One flight: the MCP request as sent, the response as received, and what it came to. */
export type OwlFlight = {
  /** The MCP endpoint the request went to. */
  readonly url: string
  /** The JSON-RPC request, as sent. */
  readonly request: string
  /** The HTTP status and JSON-RPC response, as received; null when nothing came back. */
  readonly status: number | null
  readonly response: string | null
  readonly outcome: OwlOutcome
}

/**
 * How far an errand at a perch has got. The owl sits on the perch while the player is asked whether to
 * send it, flies out of sight with the request, then comes back to the perch with the answer. Then the
 * errand is done, and can be read.
 */
export type PerchPhase = 'asking' | 'out' | 'back' | 'done'

/**
 * How long each part of the owl's flight takes to watch, in milliseconds, for players who have motion on:
 * flying off the screen, staying away while the Aviary answers, the moment between its call from out of
 * sight and its coming back into view, and flying back to the perch. The request is sent as the owl sets off.
 * `heard` is how long the owl stays away once an errand is heard from the ground: the bell starts to toll
 * while the owl is out of sight, and goes on tolling as it flies back.
 */
export const FLIGHT_MS = { out: 1000, away: 1100, heard: 1000, call: 400, back: 900 } as const
