import { Exit, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import { HOUSE_LIMITS, HOUSE_VALUE } from '../game/house.ts'
import { HouseRules, houseId } from './houses.ts'

/** Rules as a client might send them: any JSON object, valid or not. */
type Sent = { readonly action: string; readonly match: string; readonly criteria: readonly object[] }

const accepts = (rules: readonly Sent[]) => Exit.isSuccess(Schema.decodeUnknownExit(HouseRules)(rules))

const rule = (criteria: readonly object[], action = 'allow', match = 'and') => ({
  action,
  match,
  criteria,
})

describe('the rules a player may save', () => {
  it('accepts the shapes the editor builds', () => {
    expect(
      accepts([
        rule([{ kind: 'domain', is: 'game.localhost.pomerium.io' }]),
        rule([{ kind: 'email', is: 'baker@game.localhost.pomerium.io' }], 'deny', 'or'),
        rule([
          { kind: 'claim', claim: 'groups', value: 'knights' },
          { kind: 'http_method', is: 'GET' },
        ]),
        rule([{ kind: 'accept' }]),
      ]),
    ).toBe(true)
  })

  // These values end up in YAML the server writes into the cluster; each is a way out of the string.
  it.each([
    ['a quote', 'a"b@x.io'],
    ['a single quote', "a'b@x.io"],
    ['a newline', 'a@x.io\nallow: true'],
    ['a colon', 'a: b'],
    ['a space', 'a b'],
    ['a hash', 'a#b'],
    ['a brace', '{a}'],
    ['nothing', ''],
    ['too much', 'a'.repeat(255)],
  ])('refuses a value with %s', (_name, value) => {
    expect(HOUSE_VALUE.test(value)).toBe(false)
    expect(accepts([rule([{ kind: 'email', is: value }])])).toBe(false)
    expect(accepts([rule([{ kind: 'claim', claim: 'groups', value }])])).toBe(false)
  })

  it('refuses criteria the editor never offers, even ones real Pomerium has', () => {
    expect(accepts([rule([{ kind: 'groups', is: 'knights' }])])).toBe(false)
    expect(accepts([rule([{ kind: 'claim', claim: 'email', value: 'a@x.io' }])])).toBe(false)
    expect(accepts([rule([{ kind: 'http_method', is: 'DELETE' }])])).toBe(false)
    expect(accepts([rule([{ kind: 'email', is: 'a@x.io' }], 'allow', 'xor')])).toBe(false)
    expect(accepts([rule([{ kind: 'email', is: 'a@x.io' }], 'maybe')])).toBe(false)
  })

  it('refuses no rules, empty rules, and more than the house may hold', () => {
    const one = rule([{ kind: 'accept' }])

    expect(accepts([])).toBe(false)
    expect(accepts([rule([])])).toBe(false)
    expect(accepts(Array.from({ length: HOUSE_LIMITS.rules }, () => one))).toBe(true)
    expect(accepts(Array.from({ length: HOUSE_LIMITS.rules + 1 }, () => one))).toBe(false)
    expect(
      accepts([rule(Array.from({ length: HOUSE_LIMITS.criteria + 1 }, () => ({ kind: 'accept' })))]),
    ).toBe(false)
  })
})

describe('houseId', () => {
  it('is the same house for the same owner however the email is cased', () => {
    expect(houseId('Nick@Example.org')).toBe(houseId('nick@example.org'))
  })

  it('gives different owners different houses, and is safe in a DNS name', () => {
    expect(houseId('a@x.io')).not.toBe(houseId('b@x.io'))
    expect(houseId('nick@example.org')).toMatch(/^[0-9a-f]{12}$/)
  })
})
