import { describe, expect, it } from 'vite-plus/test'
import { parse } from 'yaml'
import { GROUPS } from './groups.ts'
import { OWL_TOOLS, type OwlTool } from './owl.ts'
import { decide, policyDocument, policyYaml, type Identity } from './ppl.ts'
import { ZONES, zoneById, type PolicyRule, type ZoneId } from './zones.ts'

const person = (email: string, groups: readonly string[] = []): Identity => ({
  authenticated: true,
  email,
  groups,
})

const citizen = person('nick@example.org', [GROUPS.citizens])
const knight = person('captain@example.org', [GROUPS.citizens, GROUPS.knights])
const scribe = person('scribe@example.org', [GROUPS.citizens, GROUPS.scribes])
const knightAndScholar = person('both@example.org', [GROUPS.citizens, GROUPS.knights, GROUPS.scholars])
const traveler = person('wanderer@outlands.net')
const nobody: Identity = { authenticated: false, email: '', groups: [] }

const allowed = (zone: ZoneId, who: Identity, method: 'GET' | 'POST' = 'GET') =>
  decide(zoneById(zone), who, { method, path: zoneById(zone).prefix }).allow

const KEEP_GROUPS = [GROUPS.citizens, GROUPS.knights, GROUPS.scholars]
const falconer = person('falconer@example.org', [...KEEP_GROUPS, GROUPS.falconers])

/** An MCP request to a roost: a tools/call for `tool`, or with none, a tools/list. */
const owlAllowed = (zone: ZoneId, who: Identity, tool?: OwlTool) =>
  decide(zoneById(zone), who, { method: 'POST', path: zoneById(zone).prefix, tool }).allow

describe('the owl is checked as the player, one tool call at a time', () => {
  it('lets the owl of anyone the keep admits list the Aviary’s tools and call most of them', () => {
    expect(owlAllowed('aviary', knightAndScholar)).toBe(true)
    expect(owlAllowed('aviary', knightAndScholar, OWL_TOOLS.whoami)).toBe(true)
    expect(owlAllowed('aviary', knightAndScholar, OWL_TOOLS.deliverLetter)).toBe(true)
  })

  it('keeps the owl from anyone who hasn’t finished chapter one', () => {
    expect(owlAllowed('aviary', citizen)).toBe(false)
    expect(owlAllowed('aviary', knight, OWL_TOOLS.whoami)).toBe(false)
    expect(owlAllowed('aviary', traveler)).toBe(false)
    expect(allowed('perch', citizen, 'POST')).toBe(false)
    expect(allowed('perch', knightAndScholar, 'POST')).toBe(true)
  })

  it('refuses one tool at the Aviary by name, whoever the owl flies for', () => {
    expect(owlAllowed('aviary', knightAndScholar, OWL_TOOLS.openVault)).toBe(false)
    expect(owlAllowed('aviary', falconer, OWL_TOOLS.openVault)).toBe(false)
  })

  it('opens the Rookery, and every tool there, to falconers only', () => {
    expect(owlAllowed('rookery', knightAndScholar)).toBe(false)
    expect(owlAllowed('rookery', falconer)).toBe(true)
    expect(owlAllowed('rookery', falconer, OWL_TOOLS.openVault)).toBe(true)
  })

  it('opens the gates the errands earn', () => {
    expect(allowed('mews', citizen)).toBe(false)
    expect(allowed('mews', falconer)).toBe(true)
    expect(allowed('vault', falconer)).toBe(false)
    expect(allowed('vault', person('k@example.org', [GROUPS.keyholders]))).toBe(true)
  })
})

describe('the game explains the same decision Pomerium makes for every zone', () => {
  it('lets only signed-in players through the open gates', () => {
    expect(allowed('fields', traveler)).toBe(true)
    expect(allowed('fields', nobody)).toBe(false)
  })

  it('keeps the town for the citizens group, whatever else a stranger carries', () => {
    expect(allowed('town', citizen)).toBe(true)
    expect(allowed('town', traveler)).toBe(false)
    expect(allowed('town', person('nick@example.org'))).toBe(false)
    expect(allowed('town', person('x@evil.net', [GROUPS.knights]))).toBe(false)
  })

  it('checks the knights group claim, not the email', () => {
    expect(allowed('armory', knight)).toBe(true)
    expect(allowed('armory', citizen)).toBe(false)
  })

  it('lets citizens read the library but not write to it', () => {
    expect(allowed('library', citizen, 'GET')).toBe(true)
    expect(allowed('library', citizen, 'POST')).toBe(false)
    expect(allowed('library', traveler, 'GET')).toBe(false)
  })

  it('needs scribes for the scriptorium, even though knights and citizens can read the library', () => {
    expect(allowed('scriptorium', scribe)).toBe(true)
    expect(allowed('scriptorium', knight)).toBe(false)
    expect(allowed('scriptorium', person('scribe@example.org', [GROUPS.scribes]))).toBe(false)
  })

  it('opens the keep only when every check in its one rule passes', () => {
    expect(allowed('keep', knightAndScholar)).toBe(true)
    expect(allowed('keep', knight)).toBe(false)
    expect(allowed('keep', person('s@example.org', [GROUPS.citizens, GROUPS.scholars]))).toBe(false)
    expect(allowed('keep', person('x@example.org', [GROUPS.knights, GROUPS.scholars]))).toBe(false)
  })
})

describe('decide', () => {
  const house = (...policy: PolicyRule[]) => ({ policy })
  const get = { method: 'GET', path: '/' } as const

  it('denies when no rule matches', () => {
    expect(decide(house(), citizen, get).allow).toBe(false)
  })

  it('lets a deny rule win over a matching allow rule', () => {
    const policy = house(
      {
        action: 'allow',
        match: 'and',
        criteria: [{ kind: 'claim', claim: 'groups', value: GROUPS.citizens }],
      },
      { action: 'deny', match: 'or', criteria: [{ kind: 'email', is: 'baker@example.org' }] },
    )

    expect(decide(policy, citizen, get).allow).toBe(true)
    expect(decide(policy, person('baker@example.org', [GROUPS.citizens]), get).allow).toBe(false)
  })

  it('combines criteria the way and, or and not say', () => {
    const rule = (match: PolicyRule['match']) =>
      house({
        action: 'allow',
        match,
        criteria: [
          { kind: 'email', is: 'a@x.io' },
          { kind: 'email', is: 'b@x.io' },
        ],
      })

    expect(decide(rule('and'), person('a@x.io'), get).allow).toBe(false)
    expect(decide(rule('or'), person('a@x.io'), get).allow).toBe(true)
    expect(decide(rule('not'), person('c@x.io'), get).allow).toBe(true)
    expect(decide(rule('not'), person('a@x.io'), get).allow).toBe(false)
  })

  it('lets a public house, and only a public house, in without a session', () => {
    const publicHouse = house({ action: 'allow', match: 'and', criteria: [{ kind: 'accept' }] })
    const signedInOnly = house({ action: 'allow', match: 'and', criteria: [{ kind: 'authenticated_user' }] })

    expect(decide(publicHouse, nobody, get).allow).toBe(true)
    expect(decide(signedInOnly, nobody, get).allow).toBe(false)
  })

  it('marks which criterion failed, so the denial screen can point at it', () => {
    const { lines } = decide(zoneById('keep'), knight, { method: 'GET', path: '/zones/keep' })
    const failed = lines.filter((line) => line.ok === false).map((line) => line.text.trim())

    expect(failed).toEqual(['- claim/groups: scholars'])
  })
})

describe('the policy Pomerium reads', () => {
  it('is the same document whether written as YAML for signs or as an object for the config', () => {
    for (const zone of ZONES) {
      const yaml = parse(policyYaml(zone.policy, 0).join('\n'))

      expect(yaml, zone.id).toEqual(policyDocument(zone.policy))
    }
  })

  it('writes group checks as claim/groups, which open-source Pomerium understands', () => {
    expect(policyDocument(zoneById('armory').policy)).toEqual([
      { allow: { and: [{ 'claim/groups': GROUPS.knights }] } },
    ])
  })

  it('keeps claim values that look like numbers or booleans as strings in the YAML', () => {
    const rules: readonly PolicyRule[] = [
      {
        action: 'allow',
        match: 'or',
        criteria: ['123', 'true', '1e5', GROUPS.scholars].map((value) => ({
          kind: 'claim' as const,
          claim: 'groups' as const,
          value,
        })),
      },
    ]

    expect(parse(policyYaml(rules, 0).join('\n'))).toEqual(policyDocument(rules))
  })
})
