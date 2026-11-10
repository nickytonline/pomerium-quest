import { createActor } from 'xstate'
import { describe, expect, it } from 'vite-plus/test'
import { GROUPS } from './groups.ts'
import { owlMachine, type OwlEvent } from './owl-machine.ts'

const after = (...events: OwlEvent[]) => {
  const actor = createActor(owlMachine).start()

  for (const event of events) actor.send(event)

  return actor.getSnapshot().value
}

const signedIn = (...groups: string[]): OwlEvent => ({ type: 'SIGNED_IN', groups })

const TO_VOUCHED: OwlEvent[] = [{ type: 'KEEP_ENTERED' }, { type: 'OWL_GIVEN' }, { type: 'LETTER_DELIVERED' }]

describe('the owl’s errands', () => {
  it('start only once the player is through the keep and has the owl', () => {
    expect(after({ type: 'OWL_GIVEN' })).toBe('afar')
    expect(after({ type: 'KEEP_ENTERED' }, { type: 'LETTER_DELIVERED' })).toBe('arrived')
    expect(after({ type: 'KEEP_ENTERED' }, { type: 'OWL_GIVEN' })).toBe('fledged')
  })

  it('leave the session stale after a tool call grants a group, until the player signs in again', () => {
    expect(after(...TO_VOUCHED)).toBe('vouched')
    expect(after(...TO_VOUCHED, signedIn(GROUPS.citizens))).toBe('vouched')
    expect(after(...TO_VOUCHED, signedIn(GROUPS.citizens, GROUPS.falconers))).toBe('falconer')
  })

  it('open the vault only for a session that carries keyholders', () => {
    const toEntrusted = [...TO_VOUCHED, signedIn(GROUPS.falconers), { type: 'VAULT_OPENED' } as const]

    expect(after(...toEntrusted)).toBe('entrusted')
    expect(after(...toEntrusted, { type: 'TREASURE_TAKEN' })).toBe('entrusted')
    expect(after(...toEntrusted, signedIn(GROUPS.falconers, GROUPS.keyholders))).toBe('keyholder')

    expect(
      after(...toEntrusted, signedIn(GROUPS.falconers, GROUPS.keyholders), { type: 'TREASURE_TAKEN' }),
    ).toBe('crowned')
  })

  it("end at the Throne Room, with or without the vault's chest", () => {
    const toKeyholder = [signedIn(GROUPS.falconers, GROUPS.keyholders)]

    expect(after(...TO_VOUCHED, { type: 'REUNITED' })).toBe('vouched')
    expect(after(...toKeyholder, { type: 'REUNITED' })).toBe('triumphant')
    expect(after(...toKeyholder, { type: 'TREASURE_TAKEN' }, { type: 'REUNITED' })).toBe('triumphant')
  })

  it('pick up where the claims say, in a browser that has never seen the owl', () => {
    expect(after(signedIn(GROUPS.falconers))).toBe('falconer')
    expect(after(signedIn(GROUPS.falconers, GROUPS.keyholders))).toBe('keyholder')
    expect(after(signedIn(GROUPS.citizens))).toBe('afar')
  })
})
