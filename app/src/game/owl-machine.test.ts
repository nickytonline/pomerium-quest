import { createActor } from 'xstate'
import { describe, expect, it } from 'vite-plus/test'
import { GROUPS } from './groups.ts'
import { migrate, owlMachine, type OwlEvent } from './owl-machine.ts'

const after = (...events: OwlEvent[]) => {
  const actor = createActor(owlMachine).start()

  for (const event of events) actor.send(event)

  return actor.getSnapshot().value
}

const signedIn = (...groups: string[]): OwlEvent => ({ type: 'SIGNED_IN', groups })

const TO_CAUGHT: OwlEvent[] = [{ type: 'KEEP_ENTERED' }, { type: 'OWL_SOUGHT' }, { type: 'OWL_CAUGHT' }]
const TO_VOUCHED: OwlEvent[] = [...TO_CAUGHT, { type: 'OWL_TURNED_BACK' }, { type: 'FALCONER_VOUCHED' }]
const FALCONER = signedIn(GROUPS.falconers)
const KEYHOLDER = signedIn(GROUPS.falconers, GROUPS.keyholders)

describe('the cage', () => {
  const context = (...events: OwlEvent[]) => {
    const actor = createActor(owlMachine).start()

    for (const event of events) actor.send(event)

    return actor.getSnapshot().context
  }

  it('remembers the refusal and the rescue beside the stages, without moving them', () => {
    expect(context()).toEqual({ cageRefused: false, mochisOwlFound: false })
    expect(context({ type: 'CAGE_REFUSED' })).toEqual({ cageRefused: true, mochisOwlFound: false })
    expect(context({ type: 'CAGE_REFUSED' }, { type: 'MOCHIS_OWL_FOUND' })).toEqual({
      cageRefused: true,
      mochisOwlFound: true,
    })
    expect(after(...TO_VOUCHED, FALCONER, { type: 'CAGE_REFUSED' })).toBe('falconer')
  })
})

describe('the owl’s errands', () => {
  it('start only once the player is through the keep and has caught the owl', () => {
    expect(after({ type: 'OWL_CAUGHT' })).toBe('afar')
    expect(after({ type: 'KEEP_ENTERED' }, { type: 'OWL_CAUGHT' })).toBe('arrived')
    expect(after({ type: 'KEEP_ENTERED' }, { type: 'OWL_SOUGHT' })).toBe('seeking')
    expect(after(...TO_CAUGHT)).toBe('fledged')
  })

  it('make a falconer only of someone whose owl Pomerium has turned back', () => {
    expect(after(...TO_CAUGHT, { type: 'FALCONER_VOUCHED' })).toBe('fledged')
    expect(after(...TO_CAUGHT, { type: 'OWL_TURNED_BACK' })).toBe('turned')
    expect(after(...TO_VOUCHED)).toBe('vouched')
  })

  it('leave the session stale after the Oracle adds a group, until the player signs in again', () => {
    expect(after(...TO_VOUCHED, signedIn(GROUPS.citizens))).toBe('vouched')
    expect(after(...TO_VOUCHED, signedIn(GROUPS.citizens, GROUPS.falconers))).toBe('falconer')
    expect(after(...TO_VOUCHED, FALCONER, { type: 'LETTER_DELIVERED' })).toBe('entrusted')
    expect(after(...TO_VOUCHED, FALCONER, { type: 'LETTER_DELIVERED' }, FALCONER)).toBe('entrusted')
    expect(after(...TO_VOUCHED, FALCONER, { type: 'LETTER_DELIVERED' }, KEYHOLDER)).toBe('keyholder')
  })

  it('deliver the letter only for a falconer', () => {
    expect(after(...TO_CAUGHT, { type: 'LETTER_DELIVERED' })).toBe('fledged')
    expect(after(...TO_VOUCHED, { type: 'LETTER_DELIVERED' })).toBe('vouched')
  })

  it('end only when a keyholder brings Mochi their owl', () => {
    expect(after(KEYHOLDER, { type: 'REUNITED' })).toBe('keyholder')
    expect(after(FALCONER, { type: 'MOCHIS_OWL_FOUND' }, { type: 'REUNITED' })).toBe('falconer')
    expect(after(KEYHOLDER, { type: 'MOCHIS_OWL_FOUND' }, { type: 'REUNITED' })).toBe('triumphant')
    // Mochi's owl can be found long before the last gate opens.
    expect(after(...TO_CAUGHT, { type: 'MOCHIS_OWL_FOUND' }, KEYHOLDER, { type: 'REUNITED' })).toBe(
      'triumphant',
    )
  })

  it('pick up where the claims say, in a browser that has never seen the owl', () => {
    expect(after(FALCONER)).toBe('falconer')
    expect(after(KEYHOLDER)).toBe('keyholder')
    expect(after(signedIn(GROUPS.citizens))).toBe('afar')
  })
})

describe('a save from an older version of the chapter', () => {
  const resume = (value: string) => {
    // What an older version wrote: the same snapshot, at a stage of its own and with no context.
    const saved = { ...createActor(owlMachine).start().getPersistedSnapshot(), value, context: undefined }

    return createActor(owlMachine, { snapshot: migrate(saved) })
      .start()
      .getSnapshot()
  }

  it('lands on the stage that replaced the one it stopped at', () => {
    expect(resume('crowned').value).toBe('keyholder')
  })

  it("remembers Mochi's owl was found when it was still a falcon", () => {
    const saved = {
      ...createActor(owlMachine).start().getPersistedSnapshot(),
      value: 'keyholder',
      context: { falconFound: true },
    }

    expect(migrate(saved).context).toEqual({ cageRefused: false, mochisOwlFound: true })
  })

  it('starts a save from before the cage with the cage still shut and untried', () => {
    expect(resume('falconer').context.cageRefused).toBe(false)
  })

  it("keeps every stage that still exists, with Mochi's owl still to find", () => {
    for (const stage of [
      'arrived',
      'fledged',
      'vouched',
      'falconer',
      'entrusted',
      'keyholder',
      'triumphant',
    ]) {
      expect(resume(stage).value, stage).toBe(stage)
      expect(resume(stage).context.mochisOwlFound, stage).toBe(false)
    }
  })
})
