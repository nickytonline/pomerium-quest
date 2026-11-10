// What a perch sends and hears. Sending the owl from a perch is a tool call: the browser asks the game
// server (through Pomerium's /zones/perch route), and the server makes the real MCP request to the
// Aviary, through Pomerium again, with the token Pomerium gave it for the player.
import type { OwlTool } from './owl.ts'

/** What the owl is sent to do: list the Aviary's tools, or call one. */
export type OwlCall =
  | { readonly method: 'tools/list' }
  | { readonly method: 'tools/call'; readonly tool: OwlTool }

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

/** Where the owl is on an errand: on its way out, landed on the perch, or turned back before it could land. */
export type OwlAway = 'out' | 'landed' | 'turned'

/**
 * How long each part of the owl's flight takes to watch, in milliseconds, for players who have motion on.
 * The request is already on its way while the owl flies out; the answer decides whether it lands.
 */
export const FLIGHT_MS = { out: 650, landed: 1100, turned: 750 } as const
