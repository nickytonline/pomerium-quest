import { beforeAll, describe, expect, it } from 'vite-plus/test'

import { GAME, type Player, becomeCitizen, newPlayer, sleep } from './support.ts'

let player: Player
let deedBefore = ''

const deed = async () => /"deed":"[^"]*"/.exec(await player.get('/zones/oracle/'))?.[0] ?? ''

beforeAll(async () => {
  player = await newPlayer('takeback')
  await becomeCitizen(player)
})

describe('Taking the claims back', () => {
  it('records the deed before the restart', async () => {
    deedBefore = await deed()
  })

  it('takes the claims back at the Oracle with a restart', async () => {
    expect(await player.status('/zones/oracle/reset', 'POST')).toBe(200)
  })

  it('finds taking them back again harmless', async () => {
    expect(await player.status('/zones/oracle/reset', 'POST')).toBe(200)
  })

  it('has Pomerium refresh the session with the new claims', async () => {
    expect(await player.refreshed(/"deed":null/)).toBe('refreshed')
  })

  it('carries no deed in the new session', async () => {
    expect(await player.get('/zones/oracle/')).toContain('"deed":null')
  })

  // Pomerium keeps a copy of the user's claims for up to a minute. Wait that out, so an old copy would have
  // expired.
  it('still refuses the town after the cache has expired', async () => {
    await sleep(65_000)
    expect(await player.status('/zones/town/enter')).toBe(403)
  })

  it('refuses the keep to a player with no groups', async () => {
    expect(await player.status('/zones/keep/enter')).toBe(403)
  })

  it('grants a new deed when the player becomes a citizen again', async () => {
    await becomeCitizen(player)

    const deedAfter = await deed()

    expect(deedAfter).not.toBe('')
    expect(deedAfter).not.toBe(deedBefore)
  })
})

describe('Starting over', () => {
  it('ends the session when the player signs out', async () => {
    await player.fetch('GET', `${GAME}/.pomerium/sign_out`, new Headers(), undefined, true)
    expect(await player.status('/zones/fields/enter')).toBe(401)
  })
})
