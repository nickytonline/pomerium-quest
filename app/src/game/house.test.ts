import { describe, expect, it } from 'vite-plus/test'
import { deedGroup, deedRule, turnsAwayOwner, type HouseRule } from './house.ts'
import { decide, type Identity } from './ppl.ts'
import { KINGDOM_DOMAIN } from './zones.ts'

const owner: Identity = {
  authenticated: true,
  email: `nick@${KINGDOM_DOMAIN}`,
  groups: [deedGroup('3f9a1c2b7d4e')],
}

const rule = (action: HouseRule['action'], ...criteria: HouseRule['criteria']): HouseRule => ({
  action,
  match: 'or',
  criteria,
})

describe("the owner's deed", () => {
  it('lets in whoever carries it, even when the rules name no one', () => {
    const policy = [deedRule('3f9a1c2b7d4e')]

    expect(decide({ policy }, owner, { method: 'GET', path: '/' }).allow).toBe(true)
    expect(decide({ policy }, { ...owner, groups: [] }, { method: 'GET', path: '/' }).allow).toBe(false)
  })

  it("doesn't open another owner's house", () => {
    expect(decide({ policy: [deedRule('aaaaaaaaaaaa')] }, owner, { method: 'GET', path: '/' }).allow).toBe(
      false,
    )
  })
})

describe('rules that would turn the owner away', () => {
  it('allows rules about other people, and no rules at all', () => {
    expect(turnsAwayOwner([], owner)).toBe(false)
    expect(turnsAwayOwner([rule('allow', { kind: 'email', is: 'wanderer@outlands.net' })], owner)).toBe(false)
  })

  it('catches a deny that matches the owner, whatever else the rules say', () => {
    expect(turnsAwayOwner([rule('deny', { kind: 'email', is: owner.email })], owner)).toBe(true)
    expect(turnsAwayOwner([rule('deny', { kind: 'domain', is: KINGDOM_DOMAIN })], owner)).toBe(true)
    expect(turnsAwayOwner([rule('deny', { kind: 'email', is: `baker@${KINGDOM_DOMAIN}` })], owner)).toBe(
      false,
    )
  })
})
