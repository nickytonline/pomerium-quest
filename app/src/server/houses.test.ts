import { Effect, Exit, Layer, Redacted, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'
import { GROUPS } from '../game/groups.ts'
import { HOUSE_LIMITS, HOUSE_VALUE, type HouseRule } from '../game/house.ts'
import { QuestConfig } from './config.ts'
import { HouseRules, Houses, HousesLive, houseId } from './houses.ts'
import { Kube, type KubeResponse } from './kube.ts'

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
          { kind: 'claim', claim: 'groups', value: GROUPS.knights },
          { kind: 'http_method', is: 'GET' },
        ]),
        rule([{ kind: 'accept' }]),
      ]),
    ).toBe(true)
  })

  // These values go into the policy annotation and the YAML shown to the player; each is a way out of a string.
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
    expect(accepts([rule([{ kind: 'groups', is: GROUPS.knights }])])).toBe(false)
    expect(accepts([rule([{ kind: 'claim', claim: 'email', value: 'a@x.io' }])])).toBe(false)
    expect(accepts([rule([{ kind: 'http_method', is: 'DELETE' }])])).toBe(false)
    expect(accepts([rule([{ kind: 'email', is: 'a@x.io' }], 'allow', 'xor')])).toBe(false)
    expect(accepts([rule([{ kind: 'email', is: 'a@x.io' }], 'maybe')])).toBe(false)
  })

  // No rules is a door only the deed's owner can open.
  it('accepts no rules, but refuses empty rules and more than the house may hold', () => {
    const one = rule([{ kind: 'accept' }])

    expect(accepts([])).toBe(true)
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

/** Kubernetes in memory: what was applied stays until it's deleted, and each Ingress write is an event. */
function fakeCluster() {
  const objects = new Map<string, unknown>()
  let updates = 0

  const kube = Layer.succeed(Kube, {
    call: (method, path, body) =>
      Effect.sync((): KubeResponse => {
        const name = path.split('?')[0] ?? ''

        if (path.includes('/events')) return { status: 200, body: { items: [{ count: updates }] } }

        if (method === 'GET' && path.includes('labelSelector')) {
          const items = [...objects].flatMap(([key, value]) => (key.includes('/ingresses/') ? [value] : []))

          return { status: 200, body: { items } }
        }

        if (method === 'PATCH') {
          if (name.includes('/ingresses/')) updates += 1
          objects.set(name, body)

          return { status: 200, body }
        }

        if (method === 'DELETE')
          return objects.delete(name) ? { status: 200, body: {} } : { status: 404, body: {} }

        return objects.has(name) ? { status: 200, body: objects.get(name) } : { status: 404, body: {} }
      }),
  })

  const config = Layer.succeed(QuestConfig, {
    publicOrigin: 'https://game.localhost.pomerium.io',
    keycloakUrl: '',
    keycloakRealm: '',
    keycloakClientId: '',
    keycloakClientSecret: Redacted.make(''),
    housesNamespace: 'quest-houses',
    houseLimit: 100,
    visitorPassword: Redacted.make(''),
  })

  return {
    objects,
    // A new service each run, as a new server process would be, over the same cluster.
    run: <A, E>(use: (houses: Houses['Service']) => Effect.Effect<A, E>) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* use(yield* Houses)
        }).pipe(Effect.provide(HousesLive.pipe(Layer.provide(Layer.merge(kube, config))))),
      ),
  }
}

describe("a player's saved rules", () => {
  const knights: readonly HouseRule[] = [
    { action: 'allow', match: 'or', criteria: [{ kind: 'claim', claim: 'groups', value: GROUPS.knights }] },
  ]

  it('come back from the server, so a browser that has never seen them does not make the house public', async () => {
    const cluster = fakeCluster()

    const saved = await cluster.run((houses) => houses.save('nick@example.org', knights))

    const opened = await cluster.run((houses) => houses.open('nick@example.org', null))

    expect(opened.rules).toEqual(knights)
    expect(opened.version).toBe(saved.version)
    expect(opened.version).not.toBe('public')
  })

  it('outlive the idle house: it is rebuilt from them when its Ingress has been taken down', async () => {
    const cluster = fakeCluster()
    const saved = await cluster.run((houses) => houses.save('nick@example.org', knights))

    cluster.objects.delete(`/apis/networking.k8s.io/v1/namespaces/quest-houses/ingresses/house-${saved.id}`)

    const opened = await cluster.run((houses) => houses.open('nick@example.org', null))

    expect(opened.version).toBe(saved.version)
    expect(opened.rules).toEqual(knights)
  })

  it('win over whatever a browser sends, and a player with none saved keeps what they send', async () => {
    const cluster = fakeCluster()
    const stale: readonly HouseRule[] = [{ action: 'allow', match: 'or', criteria: [{ kind: 'accept' }] }]

    await cluster.run((houses) => houses.save('nick@example.org', knights))
    expect((await cluster.run((houses) => houses.open('nick@example.org', stale))).rules).toEqual(knights)

    const fresh = await cluster.run((houses) => houses.open('sam@example.org', stale))

    expect(fresh.rules).toEqual(stale)
    expect((await cluster.run((houses) => houses.open('sam@example.org', null))).rules).toEqual(stale)
  })

  it('leave a house with none saved public', async () => {
    const opened = await fakeCluster().run((houses) => houses.open('nick@example.org', null))

    expect(opened.version).toBe('public')
    expect(opened.rules).toBeNull()
  })
})
