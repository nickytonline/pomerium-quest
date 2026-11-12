import { beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  GAME,
  GROUPS,
  PLAYERS,
  Player,
  RUN,
  TOWNSFOLK,
  becomeCitizen,
  claimGroup,
  emailIs,
  field,
  newPlayer,
  rules,
  sleep,
  type Json,
} from './support.ts'

const anon = new Player('anon')
let home: Player
let path = ''

const knights = claimGroup(GROUPS.knights)
const citizens = claimGroup(GROUPS.citizens)
const allow = (match: string, ...criteria: Json[]) => ({ action: 'allow', match, criteria })
const deny = (match: string, ...criteria: Json[]) => ({ action: 'deny', match, criteria })
const knockUrl = () => `${GAME}${path}knock`

beforeAll(async () => {
  home = await newPlayer('house')
  await becomeCitizen(home)
})

describe('Your house', () => {
  it('is public when new', async () => {
    const opened = (await home.builder('open', { rules: null })).body

    path = field(opened, 'path')
    expect(field(opened, 'version')).toBe('public')
  })

  it('lets a slime (no session) walk into a public house', async () => {
    expect(await home.liveWithin(60), 'Pomerium has taken up the public house').toBe(true)
    expect((await anon.fetch('GET', knockUrl(), new Headers({ accept: 'application/json' }))).status).toBe(
      200,
    )
  })

  it("agrees with the server's slime knock", async () => {
    expect(await home.knock('slime')).toBe('200')
  })

  // The save pause starts when the server begins a save, so the second save is sent while the first is still
  // in flight: probing after it returns could land outside the pause on a slow Pomerium.
  it('letter 1: saves the traveler (the deed lets you in)', async () => {
    const first = rules([allow('or', emailIs('wanderer@outlands.net'))])
    const saving = home.save(first)

    await sleep(200)

    expect(
      (await home.builder('save', first)).status,
      'saving again straight away waits for the builders',
    ).toBe(503)
    expect(await saving).toBe(200)
    expect(await home.knock('slime'), 'the slime is turned away').toBe('401')
    expect(await home.knock('traveler'), 'the traveler is let in').toBe('200')
    expect(await home.status(`${path}knock`), 'you are let in').toBe(200)
  })

  it('has the builders say Pomerium has taken up the rules', async () => {
    expect(await home.liveWithin(60)).toBe(true)
  })

  it('letter 2: saves no rules, so only the deed owner gets in', async () => {
    expect(await home.save(rules([]))).toBe(200)
    expect(await home.knock('traveler'), 'the traveler is refused').toBe('403')
    expect(await home.status(`${path}knock`), 'you are let in').toBe(200)
  })

  it('letter 3: saves the knights', async () => {
    expect(await home.save(rules([allow('or', knights)]))).toBe(200)
    expect(await home.knock('captain'), 'the Captain (a knight) is let in').toBe('200')
    expect(await home.knock('librarian'), 'the Librarian is refused').toBe('403')
  })

  it('letter 4: saves citizens, but denies the baker', async () => {
    const open = rules([allow('and', citizens), deny('or', emailIs(`baker@${TOWNSFOLK}`))])

    expect(await home.save(open)).toBe(200)
    expect(await home.knock('baker'), 'the baker matches the allow, but the deny wins').toBe('403')
    expect(await home.knock('librarian'), 'the Librarian is let in').toBe('200')
  })

  it('letter 5: saves the knights for GET only', async () => {
    const window = rules([allow('and', knights, { kind: 'http_method', is: 'GET' })])

    expect(await home.save(window)).toBe(200)
    expect(await home.knock('captain', 'GET'), 'the Captain may look in (GET)').toBe('200')
    expect(await home.knock('captain', 'POST'), 'the Captain may not knock (POST)').toBe('403')
    expect(await home.status(`${path}knock`, 'POST'), 'you may knock (POST)').toBe(200)
  })

  // A browser that has never seen the rules (a new device) opens the house with none: the server keeps them.
  it('keeps the saved door when opened from a fresh browser', async () => {
    const savedVersion = field((await home.builder('status', {})).body, 'version')
    const reopened = (await home.builder('open', { rules: null })).body

    expect(field(reopened, 'version')).toBe(savedVersion)
    expect(reopened, 'hands the saved rules back').toMatch(/"rules":\[\{/)
  })
})

describe('Keeping houses apart', () => {
  it('refuses rules with a quote', async () => {
    const quoted = rules([allow('or', emailIs(`x'y@${PLAYERS}`))])

    expect((await home.builder('save', quoted)).status).toBe(400)
  })

  it('refuses rules with a newline', async () => {
    const newline = rules([allow('or', emailIs('a@b\nallow_public_unauthenticated_access: true'))])

    expect((await home.builder('save', newline)).status).toBe(400)
  })

  it('refuses an unknown criterion', async () => {
    const unknown = rules([allow('or', { kind: 'groups', is: 'knights' })])

    expect((await home.builder('save', unknown)).status).toBe(400)
  })

  it('gives a neighbor a house of their own, whatever they claim', async () => {
    const neighbor = new Player(`neighbor-${RUN}@${PLAYERS}`)

    await neighbor.signUp()
    await becomeCitizen(neighbor)

    const neighborPath = field(
      (await neighbor.builder('open', { rules: null, owner: home.email })).body,
      'path',
    )

    expect(neighborPath).not.toBe('')
    expect(neighborPath).not.toBe(path)
  })

  it("doesn't let the neighbor's public house open yours", async () => {
    await home.liveWithin(60) // the last save may still be applying, and a route mid-update answers 404
    expect((await anon.fetch('GET', knockUrl(), new Headers({ accept: 'application/json' }))).status).toBe(
      401,
    )
  })

  it("lets only citizens reach the Builders' Yard", async () => {
    expect((await anon.builder('open', { rules: null })).status).toBe(401)
  })

  // Last of the saves, since it leaves the house open to anyone.
  it('accepts a door open to anyone, and lets a slime (no session) in', async () => {
    expect(await home.save(rules([{ action: 'allow', match: 'or', criteria: [{ kind: 'accept' }] }]))).toBe(
      200,
    )

    const knocked = (await home.builder('knock', { knocker: 'slime', method: 'GET' })).body

    expect(field(knocked, 'status'), `knock answered: ${knocked}`).toBe('200')
  })
})
