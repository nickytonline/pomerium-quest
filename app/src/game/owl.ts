// Chapter two's owl: an MCP client that runs errands for the player. The Aviary and the Rookery are two
// Pomerium routes in front of the same MCP server (mcp/), each with its own policy, and the owl's tools
// are named here so the server, the policies in zones.ts and the game can't drift apart.
//
// This file and groups.ts are also loaded by the MCP server, straight from Node, so they import nothing else.

/** The tools the MCP server offers, by the names a tools/call request carries. */
export const OWL_TOOLS = {
  whoami: 'whoami',
  ringBell: 'ring_bell',
  deliverLetter: 'deliver_letter',
  openVault: 'open_vault',
} as const

export type OwlTool = (typeof OWL_TOOLS)[keyof typeof OWL_TOOLS]

/** The two addresses the MCP server answers at. Each is its own route, so each has its own policy. */
export const ROOSTS = ['aviary', 'rookery'] as const

export type Roost = (typeof ROOSTS)[number]

/** The path of the MCP endpoint on a roost's host. */
export const MCP_PATH = '/mcp'

/** A roost's public origin, given the game's: the same domain and port, with the roost's name as the host's first label. */
export const roostOrigin = (gameOrigin: string, roost: Roost) => {
  const url = new URL(gameOrigin)
  url.hostname = [roost, ...url.hostname.split('.').slice(1)].join('.')

  return url.origin
}
