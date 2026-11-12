import { describe, expect, it } from 'vite-plus/test'

import { GAME, PLAYERS, Player, RUN, becomeCitizen, tools } from './support.ts'

const anon = new Player('anon')
const player = new Player(`e2e-${RUN}@${PLAYERS}`)

describe('Anonymous', () => {
  it('serves the game shell publicly', async () => {
    expect((await anon.fetch('GET', `${GAME}/`)).status).toBe(200)
  })

  it('needs a session for the fields', async () => {
    expect(await anon.status('/zones/fields/enter')).toBe(401)
  })
})

describe('Newcomer', () => {
  it('signs up and lands back in the game', async () => {
    expect(await player.signUp()).toBe(`${GAME}/?signedin=1`)
  })

  it("has the app verify Pomerium's JWT", async () => {
    expect(await player.get('/zones/oracle/')).toContain(`"email":"${player.email}"`)
  })

  it('may enter the fields', async () => {
    expect(await player.status('/zones/fields/enter')).toBe(200)
  })

  it('is refused by the town, whatever their email', async () => {
    expect(await player.status('/zones/town/enter')).toBe(403)
  })

  it("is refused by the Builders' Yard", async () => {
    expect(await player.status('/zones/builder/open', 'POST')).toBe(403)
  })
})

describe('Citizen', () => {
  it('becomes a citizen', () => becomeCitizen(player))

  it('is refused by the armory without knights', async () => {
    expect(await player.status('/zones/armory/enter')).toBe(403)
  })

  it("is refused by the owl's perch before finishing chapter one", async () => {
    expect((await player.perch(tools)).status).toBe(403)
  })

  it('may read the library (GET)', async () => {
    expect(await player.status('/zones/library/books/0')).toBe(200)
  })

  it('may not write to the library (POST)', async () => {
    expect(await player.status('/zones/library/books/0', 'POST')).toBe(403)
  })

  // The library's rule would allow this GET; a 403 means Pomerium matched the scriptorium's own route.
  it('finds the scriptorium is its own route, for scribes only', async () => {
    expect(await player.status('/zones/library/scriptorium/enter')).toBe(403)
  })
})

describe('Knighthood', () => {
  it('has the Captain knight the player', async () => {
    expect(await player.status('/zones/guild/knight', 'POST')).toBe(200)
  })

  it('still finds the armory shut (the session holds old claims)', async () => {
    expect(await player.status('/zones/armory/enter')).toBe(403)
  })

  it('has Pomerium refresh the session with the new claims', async () => {
    expect(await player.refreshed(/"knights"/)).toBe('refreshed')
  })

  it('opens the armory once Pomerium sees the new claim', async () => {
    expect(await player.gateUntilOpen('/zones/armory/enter')).toBe(200)
  })
})

describe('The Royal Keep', () => {
  it("refuses a knight who isn't a scholar", async () => {
    expect(await player.status('/zones/keep/enter')).toBe(403)
  })

  it('has the Librarian name the player a scholar', async () => {
    expect(await player.status('/zones/oracle/scholar', 'POST')).toBe(200)
  })

  it('opens for a citizen who is a knight and a scholar', async () => {
    await player.refreshed(/"scholars"/)
    expect(await player.gateUntilOpen('/zones/keep/enter')).toBe(200)
  })
})
