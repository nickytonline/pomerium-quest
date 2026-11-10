import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { GROUPS } from '../../app/src/game/groups.ts'
import { OWL_TOOLS, type OwlTool } from '../../app/src/game/owl.ts'
import type { Verified } from './identity.ts'
import { registerTools } from './tools.ts'

const PLAYER: Verified = {
  ok: true,
  caller: { email: 'nick@example.org', groups: [GROUPS.citizens], roost: 'aviary' },
}

const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

/** An owl (an MCP client) connected in memory to the tools, with the Oracle's letters kept in `granted`. */
async function owlFor(verified: Verified) {
  const granted: string[] = []
  const server = new McpServer({ name: 'test-aviary', version: '0.0.0' })

  registerTools(server, verified, async (email, group) => {
    granted.push(`${email} -> ${group}`)
  })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test-owl', version: '0.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  closers.push(
    () => client.close(),
    () => server.close(),
  )

  const call = async (tool: OwlTool) => {
    const result = await client.callTool({ name: tool, arguments: {} })

    return { failed: result.isError === true, data: result.structuredContent }
  }

  return { client, call, granted }
}

describe('the owl’s tools', () => {
  it('are the four the game and the policies name', async () => {
    const { client } = await owlFor(PLAYER)
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toEqual(Object.values(OWL_TOOLS))
  })

  it('answer as the player Pomerium signed in', async () => {
    const { call } = await owlFor(PLAYER)

    expect(await call(OWL_TOOLS.whoami)).toEqual({
      failed: false,
      data: { email: 'nick@example.org', groups: [GROUPS.citizens], roost: 'aviary' },
    })
  })

  it('write to the Oracle for the groups the gates check', async () => {
    const { call, granted } = await owlFor(PLAYER)

    expect((await call(OWL_TOOLS.deliverLetter)).data).toMatchObject({ granted: GROUPS.falconers })
    expect((await call(OWL_TOOLS.openVault)).data).toMatchObject({ granted: GROUPS.keyholders })
    expect(await call(OWL_TOOLS.ringBell)).toMatchObject({ failed: false })

    expect(granted).toEqual([
      `nick@example.org -> ${GROUPS.falconers}`,
      `nick@example.org -> ${GROUPS.keyholders}`,
    ])
  })

  it('refuse a call that didn’t come through Pomerium, and write nothing', async () => {
    const { call, granted } = await owlFor({ ok: false, reason: 'no Pomerium JWT' })

    expect(await call(OWL_TOOLS.deliverLetter)).toEqual({ failed: true, data: { error: 'no Pomerium JWT' } })
    expect(granted).toEqual([])
  })
})
