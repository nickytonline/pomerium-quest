import { Context, Effect, Layer, Option, Schedule, Schema } from 'effect'
import { createHash } from 'node:crypto'
import {
  HOUSE_LIMITS,
  HOUSE_PREFIX,
  HOUSE_VALUE,
  deedRule,
  type HouseRule,
  type HouseState,
  type OpenedHouse,
} from '../game/house.ts'
import { policyDocument } from '../game/ppl.ts'
import { QuestConfig } from './config.ts'
import { BuildersBusy, KubeUnavailable } from './errors.ts'
import { Kube, type KubeResponse } from './kube.ts'

// Each player's house is a real Pomerium route: an Ingress the game writes into the houses namespace,
// read by the Pomerium Ingress Controller. The owner always comes from Pomerium's verified JWT (see
// zones.ts), so a player can only ever write their own house.
//
// The rules a player saves are kept in a ConfigMap next to the Ingress. An idle house's Ingress is taken
// down, and a player can walk in from a browser that has never seen their rules; either way the ConfigMap
// is what the house is rebuilt from, so a house is never rebuilt public by mistake.

const ANNOTATION = 'ingress.pomerium.io'
const VERSION_HEADERS = `${ANNOTATION}/set_request_headers`

/** Houses nobody has visited for this long are taken down; walking back in rebuilds them. */
const IDLE_MS = 30 * 60 * 1000

/** How long a player waits between saves. */
const SAVE_EVERY_MS = 10_000

const Value = Schema.String.check(Schema.isPattern(HOUSE_VALUE))

const HouseCriterionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['accept', 'authenticated_user']) }),
  Schema.Struct({ kind: Schema.Literals(['domain', 'email']), is: Value }),
  Schema.Struct({ kind: Schema.Literal('claim'), claim: Schema.Literal('groups'), value: Value }),
  Schema.Struct({ kind: Schema.Literal('http_method'), is: Schema.Literals(['GET', 'POST']) }),
])

const HouseRuleSchema = Schema.Struct({
  action: Schema.Literals(['allow', 'deny']),
  match: Schema.Literals(['and', 'or', 'not']),
  criteria: Schema.Array(HouseCriterionSchema).check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(HOUSE_LIMITS.criteria),
  ),
})

/** What the editor may send. Anything else is refused before it gets near Kubernetes. */
export const HouseRules = Schema.Array(HouseRuleSchema).check(Schema.isMaxLength(HOUSE_LIMITS.rules))

const IngressMeta = Schema.Struct({
  metadata: Schema.Struct({
    name: Schema.String,
    labels: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    annotations: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
})

const IngressList = Schema.Struct({ items: Schema.Array(IngressMeta) })

const StoredRules = Schema.Struct({ data: Schema.Struct({ rules: Schema.fromJsonString(HouseRules) }) })

const EventList = Schema.Struct({
  items: Schema.Array(Schema.Struct({ count: Schema.optional(Schema.Number) })),
})

/**
 * How long a save waits for Pomerium to take up the new rules. It stays under Pomerium's 30 second
 * route timeout; a knock checks the rules version itself if the builders are slower than this.
 */
const PICKUP_MS = 25_000

/** After a save has answered, how much longer to keep watching for Pomerium to take up the rules. */
const WATCH_MS = 3 * 60_000

const VersionHeader = Schema.fromJsonString(Schema.Struct({ 'X-House-Version': Schema.String }))

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12)

/** A house's id: a hash of its owner's email, so it's DNS-safe and keeps the email out of URLs. */
export const houseId = (owner: string) => hash(owner.toLowerCase())

/** Which rules a house is enforcing; Pomerium hands it to the house as X-House-Version. */
const versionOf = (rules: readonly HouseRule[] | null) =>
  rules ? hash(`deed:${JSON.stringify(rules)}`) : 'public'

export class Houses extends Context.Service<
  Houses,
  {
    /**
     * Builds the house if it isn't standing and marks it visited. The rules the server saved for the player
     * win; the ones sent are used only for a player with none saved (and are saved then).
     */
    readonly open: (
      owner: string,
      rules: readonly HouseRule[] | null,
    ) => Effect.Effect<OpenedHouse, KubeUnavailable | BuildersBusy>
    /** Checks the player's rules and puts them on the door. */
    readonly save: (
      owner: string,
      rules: readonly HouseRule[],
    ) => Effect.Effect<HouseState, KubeUnavailable | BuildersBusy>
    /** The house as it stands, or null when it isn't standing. */
    readonly state: (owner: string) => Effect.Effect<HouseState | null, KubeUnavailable>
    /** Takes down houses nobody has visited lately. */
    readonly sweep: Effect.Effect<number, KubeUnavailable>
  }
>()('Houses') {}

export const HousesLive = Layer.effect(
  Houses,
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const kube = yield* Kube
    const host = new URL(config.publicOrigin).hostname
    const base = `/apis/networking.k8s.io/v1/namespaces/${config.housesNamespace}/ingresses`
    const rulesBase = `/api/v1/namespaces/${config.housesNamespace}/configmaps`
    const eventsBase = `/api/v1/namespaces/${config.housesNamespace}/events`
    const lastSaved = new Map<string, number>()

    // When each house was last visited. Kept here rather than on the Ingress: every change to an Ingress
    // makes the controller re-check Pomerium's whole config. After a restart, every standing house gets
    // a fresh IDLE_MS.
    const lastVisited = new Map<string, number>()
    const startedAt = Date.now()

    // Houses whose latest rules Pomerium hasn't taken up yet: the house's id, and the version waiting.
    const pending = new Map<string, string>()
    const live = (id: string, version: string) => pending.get(id) !== version

    const failed = ({ status, body }: KubeResponse) =>
      new KubeUnavailable({ reason: `Kubernetes answered ${status}: ${JSON.stringify(body).slice(0, 300)}` })

    const list = kube
      .call('GET', `${base}?labelSelector=quest%2Fhouse`)
      .pipe(
        Effect.flatMap((response) =>
          response.status === 200
            ? Schema.decodeUnknownEffect(IngressList)(response.body).pipe(
                Effect.mapError((issue) => new KubeUnavailable({ reason: issue.message })),
              )
            : Effect.fail(failed(response)),
        ),
      )

    /** The rules version a standing house enforces, or null when it isn't standing. */
    const standing = (id: string) =>
      kube.call('GET', `${base}/house-${id}`).pipe(
        Effect.flatMap((response) =>
          response.status === 200
            ? Schema.decodeUnknownEffect(IngressMeta)(response.body).pipe(
                Effect.flatMap((ingress) =>
                  Schema.decodeUnknownEffect(VersionHeader)(ingress.metadata.annotations?.[VERSION_HEADERS]),
                ),
                Effect.map((headers) => headers['X-House-Version']),
                // A house the game can't read is rebuilt.
                Effect.orElseSucceed(() => 'unknown'),
              )
            : Effect.succeed(null),
        ),
      )

    /** The rules the player last saved, or undefined when they never have (or the ConfigMap is unreadable). */
    const saved = (id: string) =>
      kube.call('GET', `${rulesBase}/house-${id}-rules`).pipe(
        Effect.flatMap((response) =>
          response.status === 200
            ? Schema.decodeUnknownEffect(StoredRules)(response.body).pipe(
                Effect.map(({ data }) => data.rules),
                Effect.orElseSucceed(() => undefined),
              )
            : Effect.succeed(undefined),
        ),
      )

    const remember = (id: string, rules: readonly HouseRule[]) =>
      Effect.gen(function* () {
        const response = yield* kube.call(
          'PATCH',
          `${rulesBase}/house-${id}-rules?fieldManager=quest&force=true`,
          {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: `house-${id}-rules`, namespace: config.housesNamespace },
            data: { rules: JSON.stringify(rules) },
          },
        )

        if (response.status !== 200 && response.status !== 201) return yield* failed(response)
      })

    // The Ingress Controller records an "Updated" event each time it applies an Ingress. Kubernetes
    // folds repeats into one event and counts them, so a higher count means Pomerium has the change.
    const updates = (id: string) =>
      kube
        .call(
          'GET',
          `${eventsBase}?fieldSelector=${encodeURIComponent(`involvedObject.name=house-${id},reason=Updated`)}`,
        )
        .pipe(
          Effect.flatMap((response) => Schema.decodeUnknownEffect(EventList)(response.body)),
          Effect.map(({ items }) => items.reduce((total, event) => total + (event.count ?? 1), 0)),
          Effect.orElseSucceed(() => 0),
        )

    const write = (id: string, rules: readonly HouseRule[] | null) =>
      Effect.gen(function* () {
        const version = versionOf(rules)
        const before = yield* updates(id)

        // A new house is public: Pomerium lets every request through, signed in or not. Once the player
        // saves, the policy replaces the public flag. Pomerium doesn't allow both on one route.
        const door = rules
          ? { [`${ANNOTATION}/policy`]: JSON.stringify(policyDocument([deedRule(id), ...rules])) }
          : { [`${ANNOTATION}/allow_public_unauthenticated_access`]: 'true' }

        const ingress = {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'Ingress',
          metadata: {
            name: `house-${id}`,
            namespace: config.housesNamespace,
            labels: { 'app.kubernetes.io/part-of': 'quest', 'quest/house': id },
            annotations: {
              [`${ANNOTATION}/pass_identity_headers`]: 'true',
              [VERSION_HEADERS]: JSON.stringify({ 'X-House-Version': version }),
              ...door,
            },
          },
          spec: {
            ingressClassName: 'pomerium',
            rules: [
              {
                host,
                http: {
                  paths: [
                    {
                      path: `${HOUSE_PREFIX}/${id}/`,
                      pathType: 'Prefix',
                      backend: { service: { name: 'quest', port: { number: 3000 } } },
                    },
                  ],
                },
              },
            ],
          },
        }

        // Server-side apply, so annotations the game stops writing (like the public flag) go away.
        const response = yield* kube.call(
          'PATCH',
          `${base}/house-${id}?fieldManager=quest&force=true`,
          ingress,
        )

        if (response.status !== 200 && response.status !== 201) return yield* failed(response)
        pending.set(id, version)

        // Pomerium has the new rules once the controller records another update to the Ingress.
        const pickedUp = updates(id).pipe(
          Effect.repeat({ schedule: Schedule.spaced('500 millis'), until: (count) => count > before }),
          Effect.tap(() =>
            Effect.sync(() => {
              if (pending.get(id) === version) pending.delete(id)
            }),
          ),
        )

        // Wait a while, so nobody knocks on the old rules. If Pomerium is slower than that, answer anyway
        // and keep watching in the background, so the game can say when the rules take hold.
        const tookHold = yield* pickedUp.pipe(Effect.timeoutOption(PICKUP_MS))

        if (Option.isNone(tookHold))
          yield* pickedUp.pipe(Effect.timeoutOption(WATCH_MS), Effect.ignore, Effect.forkDetach)

        return { id, path: `${HOUSE_PREFIX}/${id}/`, version, live: live(id, version) }
      })

    /** Puts up the house with these rules, unless it already stands with them. */
    const build = (owner: string, rules: readonly HouseRule[] | null) =>
      Effect.gen(function* () {
        const id = houseId(owner)
        const version = versionOf(rules)
        const current = yield* standing(id)
        lastVisited.set(id, Date.now())

        if (current === version)
          return { id, path: `${HOUSE_PREFIX}/${id}/`, version, live: live(id, version) }

        // Houses already standing are always rebuilt; a new one waits once the limit is reached.
        if (current === null) {
          const { items } = yield* list

          if (items.length >= config.houseLimit)
            return yield* new BuildersBusy({ reason: 'every builder is busy', retryAfterSeconds: 60 })
        }

        return yield* write(id, rules)
      })

    const save = (owner: string, rules: readonly HouseRule[]) =>
      Effect.gen(function* () {
        const now = Date.now()
        const since = now - (lastSaved.get(owner) ?? 0)

        if (since < SAVE_EVERY_MS)
          return yield* new BuildersBusy({
            reason: 'the builders are still at work on your last change',
            retryAfterSeconds: Math.ceil((SAVE_EVERY_MS - since) / 1000),
          })

        lastSaved.set(owner, now)
        // Saved first: if it fails nothing has changed, and if the build then can't start, walking in rebuilds
        // the house from these rules.
        yield* remember(houseId(owner), rules)

        return yield* build(owner, rules)
      })

    const sweep = Effect.gen(function* () {
      const { items } = yield* list
      const cutoff = Date.now() - IDLE_MS

      const idle = items.filter((item) => {
        const id = item.metadata.labels?.['quest/house'] ?? ''

        return (lastVisited.get(id) ?? startedAt) < cutoff
      })

      yield* Effect.forEach(idle, (item) => kube.call('DELETE', `${base}/${item.metadata.name}`), {
        discard: true,
      })

      for (const item of idle) lastVisited.delete(item.metadata.labels?.['quest/house'] ?? '')

      return idle.length
    })

    // Clean up in the background for as long as the server runs. A failed sweep tries again next time.
    yield* sweep.pipe(Effect.ignore, Effect.repeat(Schedule.spaced('1 minute')), Effect.forkDetach)

    const state = (owner: string) =>
      Effect.gen(function* () {
        const id = houseId(owner)
        const version = yield* standing(id)
        lastVisited.set(id, Date.now())

        return version === null
          ? null
          : { id, path: `${HOUSE_PREFIX}/${id}/`, version, live: live(id, version) }
      })

    const open = (owner: string, sent: readonly HouseRule[] | null) =>
      Effect.gen(function* () {
        const id = houseId(owner)
        const kept = yield* saved(id)
        const rules = kept ?? sent

        // A house saved before rules were kept here is remembered the first time its owner walks in.
        if (kept === undefined && sent) yield* remember(id, sent)

        return { ...(yield* build(owner, rules)), rules }
      })

    return { open, save, state, sweep }
  }),
)
