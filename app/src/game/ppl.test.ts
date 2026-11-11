import { describe, expect, it } from 'vite-plus/test'
import { parse } from 'yaml'
import { GRANTED_GROUPS, GROUPS } from './groups.ts'
import { OWL_TOOLS, isForbidden, type OwlTool } from './owl.ts'
import { FALCONER } from './perch.ts'
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

/** An MCP request to the Aviary: a tools/call for `tool`, or with none, a tools/list. */
const owlAllowed = (who: Identity, tool?: OwlTool) =>
  decide(zoneById('aviary'), who, { method: 'POST', path: zoneById('aviary').prefix, tool }).allow

describe('the owl is checked on the player’s behalf, one tool call at a time', () => {
  it('lets anyone the keep admits send an owl from the perch', () => {
    expect(allowed('perch', citizen, 'POST')).toBe(false)
    expect(allowed('perch', knightAndScholar, 'POST')).toBe(true)
  })

  it('turns back the owl of anyone who is not a falconer, whatever it asks for', () => {
    expect(owlAllowed(knightAndScholar)).toBe(false)
    expect(owlAllowed(knightAndScholar, OWL_TOOLS.whoami)).toBe(false)
    expect(owlAllowed(traveler, OWL_TOOLS.ringBell)).toBe(false)
  })

  it('lets a falconer’s owl list the tools and call the allowed ones', () => {
    expect(owlAllowed(falconer)).toBe(true)

    for (const tool of Object.values(OWL_TOOLS).filter((name) => !isForbidden(name)))
      expect(owlAllowed(falconer, tool), tool).toBe(true)
  })

  it('forbids the open_ tools to a player’s owl with one deny rule, whatever groups a player can earn', () => {
    const forbidden = Object.values(OWL_TOOLS).filter(isForbidden)

    expect(forbidden).toEqual([OWL_TOOLS.openCage])

    for (const tool of forbidden) {
      expect(owlAllowed(falconer, tool), tool).toBe(false)
      expect(owlAllowed(person('k@example.org', GRANTED_GROUPS), tool), tool).toBe(false)
    }

    expect(zoneById('aviary').policy.filter((rule) => rule.action === 'deny')).toHaveLength(1)
  })

  it('lets the Falconer’s owl call the open_ tools, and everything a player’s owl may', () => {
    const distinguished = person(FALCONER.email, FALCONER.groups)

    expect(allowed('perch', distinguished, 'POST')).toBe(true)
    expect(owlAllowed(distinguished)).toBe(true)

    for (const tool of Object.values(OWL_TOOLS)) expect(owlAllowed(distinguished, tool), tool).toBe(true)
  })

  it('never grants a player the group that opens things', () => {
    expect(GRANTED_GROUPS).not.toContain(GROUPS.distinguishedFalconers)
  })

  it('writes the deny rule with starts_with and exclude, as Pomerium reads it', () => {
    expect(policyDocument(zoneById('aviary').policy)).toEqual([
      { allow: { and: [{ 'claim/groups': GROUPS.falconers }] } },
      {
        deny: {
          and: [
            { mcp_tool: { starts_with: 'open_' } },
            { 'claim/groups': { exclude: GROUPS.distinguishedFalconers } },
          ],
        },
      },
    ])
  })

  it('opens the Eyrie only to someone who holds every group both chapters earn', () => {
    const everything = [GROUPS.citizens, GROUPS.knights, GROUPS.scholars, GROUPS.falconers, GROUPS.keyholders]

    expect(allowed('eyrie', person('k@example.org', everything))).toBe(true)
    expect(allowed('eyrie', falconer)).toBe(false)

    for (const missing of everything)
      expect(
        allowed(
          'eyrie',
          person(
            'k@example.org',
            everything.filter((group) => group !== missing),
          ),
        ),
      ).toBe(false)
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
