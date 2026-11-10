// Chapter two's owl: an MCP client that runs errands on the player's behalf. The Aviary is the MCP server
// (mcp/), behind one Pomerium route, and each of its tools has a perch in the Aviary's grounds. The tools
// are named here so the server, the policy in zones.ts and the game can't drift apart.
//
// This file and groups.ts are also loaded by the MCP server, straight from Node, so they import nothing else.

/** The tools the MCP server offers, by the names a tools/call request carries. */
export const OWL_TOOLS = {
  whoami: 'whoami',
  ringBell: 'ring_bell',
  scoutGrounds: 'scout_grounds',
  deliverLetter: 'deliver_letter',
  openVault: 'open_vault',
  openCages: 'open_cages',
} as const

export type OwlTool = (typeof OWL_TOOLS)[keyof typeof OWL_TOOLS]

/** Every tool whose name starts with this is forbidden to every owl: the Aviary's deny rule names the prefix. */
export const FORBIDDEN_PREFIX = 'open_'

export const isForbidden = (tool: string) => tool.startsWith(FORBIDDEN_PREFIX)

/** What each tool is called and does, as the server's tools/list tells it and each perch's sign shows it. */
export const OWL_ERRANDS: Record<OwlTool, { readonly title: string; readonly description: string }> = {
  [OWL_TOOLS.whoami]: {
    title: 'Who am I?',
    description: 'Reads back who the owl is flying for: the email and groups in your Pomerium session.',
  },
  [OWL_TOOLS.ringBell]: {
    title: 'Ring the bell',
    description: 'Flies up to the bell tower, where no dog can climb, and rings the bell.',
  },
  [OWL_TOOLS.scoutGrounds]: {
    title: 'Scout the grounds',
    description: 'Circles high over the Aviary and reports what it sees from up there.',
  },
  [OWL_TOOLS.deliverLetter]: {
    title: 'Deliver the letter',
    description: "Carries the Falconer's letter to the Oracle, who adds you to the keyholders group.",
  },
  [OWL_TOOLS.openVault]: {
    title: 'Open the vault',
    description: "Unlocks the Royal Vault. The Aviary's orders forbid it to every owl.",
  },
  [OWL_TOOLS.openCages]: {
    title: 'Open the cages',
    description: "Lets every bird in the Aviary loose. The Aviary's orders forbid it to every owl.",
  },
}

/** The first label of the Aviary's host: the MCP server has a host of its own, beside the game's. */
export const AVIARY_HOST = 'aviary'

/** The path of the MCP endpoint on the Aviary's host. */
export const MCP_PATH = '/mcp'

/** The Aviary's public origin, given the game's: the same domain and port, with the host's first label swapped. */
export const aviaryOrigin = (gameOrigin: string) => {
  const url = new URL(gameOrigin)
  url.hostname = [AVIARY_HOST, ...url.hostname.split('.').slice(1)].join('.')

  return url.origin
}
