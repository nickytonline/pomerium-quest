import { createActor } from 'xstate'
import { describe, expect, it } from 'vite-plus/test'
import { houseMachine } from './house-machine.ts'
import { KNIGHT_QUOTA, questMachine } from './quest-machine.ts'

const start = () => createActor(questMachine).start()

const beatSlimes = (actor: ReturnType<typeof start>, count: number) => {
  for (let i = 0; i < count; i++) actor.send({ type: 'MONSTER_DEFEATED', kind: 'bot' })
}

const toProven = () => {
  const actor = start()

  actor.send({ type: 'SIGNED_IN', groups: ['citizen'] })
  beatSlimes(actor, KNIGHT_QUOTA)

  return actor
}

describe("chapter one's quest", () => {
  it('starts anonymous and becomes a citizen on sign-in with the citizen claim', () => {
    const actor = start()

    expect(actor.getSnapshot().value).toBe('anonymous')
    actor.send({ type: 'SIGNED_IN', groups: ['citizen'] })
    expect(actor.getSnapshot().value).toBe('citizen')
  })

  it('makes a newcomer a citizen only once a sign-in carries the claim the Oracle granted', () => {
    const actor = start()

    actor.send({ type: 'SIGNED_IN', groups: [] })
    expect(actor.getSnapshot().value).toBe('newcomer')

    actor.send({ type: 'SAGE_SPOKE' })
    expect(actor.getSnapshot().value).toBe('invited')

    actor.send({ type: 'CITIZEN_GRANTED' })
    expect(actor.getSnapshot().value).toBe('granted')

    // The session still holds the claims from sign-in.
    actor.send({ type: 'SIGNED_IN', groups: [] })
    expect(actor.getSnapshot().value).toBe('granted')

    actor.send({ type: 'SIGNED_IN', groups: ['citizen'] })
    expect(actor.getSnapshot().value).toBe('citizen')
  })

  it('sends a session from before citizens were a claim back to be granted it', () => {
    const actor = toProven()

    actor.send({ type: 'SIGNED_IN', groups: [] })
    expect(actor.getSnapshot().value).toBe('invited')
    actor.send({ type: 'CITIZEN_GRANTED' })
    actor.send({ type: 'SIGNED_IN', groups: ['citizen'] })
    expect(actor.getSnapshot().value).toBe('proven')
  })

  it('gives a knight their rank back once the Oracle has granted citizenship', () => {
    const actor = toProven()

    actor.send({ type: 'KNIGHTED' })
    actor.send({ type: 'SIGNED_IN', groups: ['citizen', 'knights'] })
    actor.send({ type: 'STEEL_TAKEN' })
    actor.send({ type: 'SIGNED_IN', groups: ['knights'] })
    actor.send({ type: 'CITIZEN_GRANTED' })
    actor.send({ type: 'SIGNED_IN', groups: ['citizen', 'knights'] })
    expect(actor.getSnapshot().value).toBe('armed')
    expect(actor.getSnapshot().context.resume).toBeUndefined()
  })

  it('keeps a knighted player knighted until the session carries the knights claim', () => {
    const actor = toProven()

    actor.send({ type: 'KNIGHTED' })
    actor.send({ type: 'SIGNED_IN', groups: [] })
    actor.send({ type: 'CITIZEN_GRANTED' })
    actor.send({ type: 'SIGNED_IN', groups: ['citizen'] })
    expect(actor.getSnapshot().value).toBe('knighted')
    actor.send({ type: 'SIGNED_IN', groups: ['citizen', 'knights'] })
    expect(actor.getSnapshot().value).toBe('knight')
  })

  it('is proven only after the full quota of slimes, however they were counted before signing in', () => {
    const actor = start()

    beatSlimes(actor, KNIGHT_QUOTA)
    expect(actor.getSnapshot().value).toBe('anonymous')
    actor.send({ type: 'SIGNED_IN', groups: ['citizen'] })
    expect(actor.getSnapshot().value).toBe('proven')

    const short = start()

    short.send({ type: 'SIGNED_IN', groups: ['citizen'] })
    beatSlimes(short, KNIGHT_QUOTA - 1)
    expect(short.getSnapshot().value).toBe('citizen')
  })

  it('stays knighted until a fresh sign-in actually carries the knights claim', () => {
    const actor = toProven()

    actor.send({ type: 'KNIGHTED' })
    expect(actor.getSnapshot().value).toBe('knighted')

    // The session still holds its old claims: signing in again without the group changes nothing.
    actor.send({ type: 'SIGNED_IN', groups: ['citizen', 'scholars'] })
    expect(actor.getSnapshot().value).toBe('knighted')

    actor.send({ type: 'SIGNED_IN', groups: ['citizen', 'knights'] })
    expect(actor.getSnapshot().value).toBe('knight')
  })

  it('cannot take the steel before being a knight', () => {
    const actor = toProven()

    actor.send({ type: 'STEEL_TAKEN' })
    expect(actor.getSnapshot().value).toBe('proven')
  })

  it('goes back to anonymous when signing out before being knighted', () => {
    const actor = toProven()

    actor.send({ type: 'SIGNED_OUT' })
    expect(actor.getSnapshot().value).toBe('anonymous')
  })

  it('reaches armed through the whole story', () => {
    const actor = toProven()

    actor.send({ type: 'KNIGHTED' })
    actor.send({ type: 'SIGNED_IN', groups: ['citizen', 'knights'] })
    actor.send({ type: 'STEEL_TAKEN' })
    expect(actor.getSnapshot().value).toBe('armed')
  })
})

describe("the house's letters", () => {
  it('come one at a time, each unread until the player opens it', () => {
    const actor = createActor(houseMachine).start()
    const letters: string[] = []

    actor.send({ type: 'DEED_GIVEN' })

    for (let i = 0; i < 10 && actor.getSnapshot().value !== 'done'; i++) {
      letters.push(String(actor.getSnapshot().value))
      actor.send({ type: 'LETTER_READ' })
      expect(actor.getSnapshot().context.letterRead).toBe(true)
      actor.send({ type: 'LETTER_SOLVED' })
      expect(actor.getSnapshot().context.letterRead).toBe(false)
    }

    expect(letters).toEqual(['slimes', 'bread', 'guild', 'baker', 'window'])
  })

  it('ignores a solved letter before the player has the deed', () => {
    const actor = createActor(houseMachine).start()

    actor.send({ type: 'LETTER_SOLVED' })
    expect(actor.getSnapshot().value).toBe('unowned')
  })

  it('sends a saved player whose session lacks the citizen claim back to the Oracle', () => {
    const proven = toProven()

    proven.send({ type: 'SIGNED_IN', groups: [] })
    expect(proven.getSnapshot().value).toBe('invited')

    const armed = toProven()

    armed.send({ type: 'KNIGHTED' })
    armed.send({ type: 'SIGNED_IN', groups: ['citizen', 'knights'] })
    armed.send({ type: 'STEEL_TAKEN' })
    armed.send({ type: 'SIGNED_IN', groups: ['knights'] })
    expect(armed.getSnapshot().value).toBe('invited')

    const knighted = toProven()

    knighted.send({ type: 'KNIGHTED' })
    knighted.send({ type: 'SIGNED_IN', groups: ['knights'] })
    expect(knighted.getSnapshot().value).toBe('invited')
  })
})
