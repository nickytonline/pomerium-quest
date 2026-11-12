import { beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  AVIARY,
  GROUPS,
  type Json,
  type Player,
  TOWNSFOLK,
  becomeCitizen,
  call,
  field,
  newPlayer,
  reachTheKeep,
  tools,
} from './support.ts'

let player: Player

// Chapter two starts where chapter one ends: a citizen who is a knight and a scholar.
beforeAll(async () => {
  player = await newPlayer('aviary')
  await becomeCitizen(player)
  await reachTheKeep(player)
})

describe('The Aviary (MCP)', () => {
  const kind = async (body: Json) => field((await player.perch(body)).body, 'outcome.kind')

  it('takes a token, not a browser session, on an MCP server route', async () => {
    const jar = await player.fetch(
      'POST',
      `${AVIARY}/mcp`,
      new Headers({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' }),
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    )

    expect(jar.status).toBe(401)
  })

  it('refuses the owl of a player who is no falconer, before any tool is looked at', async () => {
    expect(await kind(tools)).toBe('refused')
  })

  it('refuses its whoami call just the same', async () => {
    expect(await kind(call('whoami'))).toBe('refused')
  })

  it('has the Eyrie refuse a player who is neither falconer nor keyholder', async () => {
    expect(await player.status('/zones/eyrie/enter')).toBe(403)
  })

  it('has the Falconer vouch for the player, and the Oracle add falconers', async () => {
    const vouched = await player.send('POST', '/zones/keep/falconer')

    expect(vouched.body).toContain(`"granted":"${GROUPS.falconers}"`)
  })

  it('still refuses (the session holds old claims)', async () => {
    expect(await kind(tools)).toBe('refused')
  })

  it("lists its tools for a falconer's owl", async () => {
    await player.refreshed(/"falconers"/)
    expect(await player.perchUntil(tools, 'tools')).toBe('tools')
  })

  it('lists all five, the forbidden one too', async () => {
    // SAFETY: the Aviary answers a tools list with the tools it has; a different shape fails the test below.
    const listed = JSON.parse((await player.perch(tools)).body) as { outcome: { tools: { name: string }[] } }

    expect(listed.outcome.tools.map((tool) => tool.name).join(',')).toBe(
      'whoami,ring_bell,scout_grounds,deliver_letter,open_cage',
    )
  })

  it("flies on the player's behalf for whoami", async () => {
    expect(field((await player.perch(call('whoami'))).body, 'outcome.text')).toContain(player.email)
  })

  it("allows ring_bell for a falconer's owl", async () => {
    expect(await kind(call('ring_bell'))).toBe('result')
  })

  it('allows scout_grounds too', async () => {
    expect(await kind(call('scout_grounds'))).toBe('result')
  })

  it('refuses open_cage for a falconer (deny: mcp_tool starts_with open_, groups exclude distinguished-falconers)', async () => {
    expect(await kind(call('open_cage'))).toBe('refused')
  })

  // The Falconer has an account of their own, in the distinguished-falconers group. The game sends their owl
  // from the same perch to the same tool, and Pomerium decides it on the Falconer's behalf.
  it("lets the Falconer's owl call open_cage: same route, same tool, another identity", async () => {
    const falconersOwl = (await player.send('POST', '/zones/perch/falconer')).body

    expect(field(falconersOwl, 'outcome.kind')).toBe('result')
    expect(field(falconersOwl, 'outcome.text')).toContain(`falconer@${TOWNSFOLK}`)
  })

  it('has the Eyrie refuse a falconer who is no keyholder', async () => {
    expect(await player.status('/zones/eyrie/enter')).toBe(403)
  })

  it('has deliver_letter ask the Oracle to add keyholders', async () => {
    const delivered = field((await player.perch(call('deliver_letter'))).body, 'outcome.text')

    expect(delivered).toContain(`"granted": "${GROUPS.keyholders}"`)
  })

  it('still refuses the Eyrie (the session holds old claims)', async () => {
    expect(await player.status('/zones/eyrie/enter')).toBe(403)
  })

  it('opens the Eyrie to all five groups, ending chapter two', async () => {
    await player.refreshed(/"keyholders"/)
    expect(await player.gateUntilOpen('/zones/eyrie/enter')).toBe(200)
  })

  it('keeps open_cage refused, even for a keyholder', async () => {
    expect(await kind(call('open_cage'))).toBe('refused')
  })

  it('takes falconers and keyholders back with a restart', async () => {
    expect(await player.status('/zones/oracle/reset', 'POST')).toBe(200)
  })
})
