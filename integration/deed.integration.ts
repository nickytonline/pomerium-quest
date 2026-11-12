import { beforeAll, describe, expect, it } from 'vite-plus/test'

import { type Player, becomeCitizen, field, newPlayer, rules, sleep } from './support.ts'

let home: Player
let path = ''

beforeAll(async () => {
  home = await newPlayer('deed')
  await becomeCitizen(home)
  path = field((await home.builder('open', { rules: null })).body, 'path')
})

describe('The deed is for one game', () => {
  // Only the deed may open the door now, so a player with no deed is refused at their own door.
  it('saves no rules, so only the deed opens the door', async () => {
    expect(await home.save(rules([]))).toBe(200)
    expect(await home.liveWithin(60), 'the builders say Pomerium has taken up the rules').toBe(true)
  })

  it("lets the owner's deed in", async () => {
    expect(await home.status(`${path}knock`)).toBe(200)
  })

  it("takes the owner's deed back with a restart", async () => {
    expect(await home.status('/zones/oracle/reset', 'POST')).toBe(200)
    await home.refreshed(/"deed":null/)
  })

  it('refuses the owner at their own door with no deed', async () => {
    await sleep(65_000) // Pomerium keeps a copy of the user's claims for up to a minute
    expect(await home.status(`${path}knock`)).toBe(403)
  })

  it('has the builders rebuild the door with the new deed', async () => {
    await becomeCitizen(home)
    expect((await home.builder('open', rules([]))).status).toBe(200)
    expect(await home.liveWithin(60), 'Pomerium has taken up the new door').toBe(true)
  })

  it("lets the owner's new deed in again", async () => {
    expect(await home.status(`${path}knock`)).toBe(200)
  })
})
