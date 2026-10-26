// Everything the characters say, what the signs show and what each lesson links to.
import { KINGDOM_DOMAIN, type ZoneId } from './zones.ts'

/** Every gate has a sign. Most are named for their zone; the scriptorium's door is the library's second rule. */
export type SignId = ZoneId | 'scriptorium'

/** A sign's heading, where it isn't its zone's name. */
export const SIGN_NAME: Partial<Record<SignId, string>> = { scriptorium: 'Scriptorium' }

const DOCS = 'https://www.pomerium.com/docs'

export interface DocLink {
  readonly label: string
  readonly href: string
}

/** An answer the player can give; picking it closes the dialog. */
export interface Choice {
  readonly label: string
  readonly pick: () => void
}

export interface Page {
  readonly who: string
  readonly text: string
  readonly code?: string
  readonly links?: readonly DocLink[]
  /** Shown as buttons in place of "continue"; only valid on a dialog's last page. */
  readonly choices?: readonly Choice[]
}

export const LESSONS = {
  every: {
    title: 'Every request is checked',
    link: { label: 'Zero trust', href: `${DOCS}/internals/zero-trust` },
  },
  idp: {
    title: 'Your identity provider proves who you are',
    link: { label: 'Identity providers', href: `${DOCS}/integrations/user-identity/identity-providers` },
  },
  route: {
    title: 'A route pairs an address with a policy',
    link: { label: 'Routes', href: `${DOCS}/reference/routes` },
  },
  authz: {
    title: 'Signed in is not the same as allowed',
    link: { label: 'Authorization', href: `${DOCS}/capabilities/authorization` },
  },
  claims: {
    title: 'Claims come from your identity provider',
    link: { label: 'PPL: the claim criterion', href: `${DOCS}/internals/ppl#supported-ppl-criteria` },
  },
  refresh: {
    title: 'Your session holds the claims from sign-in',
    link: { label: 'Sessions', href: `${DOCS}/internals/sessions` },
  },
  onroute: {
    title: 'Policies live on routes, not on people',
    link: { label: 'Route policy', href: `${DOCS}/reference/routes/policy` },
  },
  request: {
    title: 'Rules can check the request itself',
    link: { label: 'PPL criteria', href: `${DOCS}/internals/ppl#supported-ppl-criteria` },
  },
  defaultDeny: {
    title: 'No matching allow rule means no entry',
    link: { label: 'PPL: allow and deny', href: `${DOCS}/internals/ppl#actions` },
  },
  jwt: {
    title: 'Apps behind a route get a signed identity',
    link: { label: "Getting the user's identity", href: `${DOCS}/capabilities/getting-users-identity` },
  },
  verify: {
    title: 'Apps should verify that signature',
    link: { label: 'JWT verification', href: `${DOCS}/get-started/fundamentals/core/jwt-verification` },
  },
  allOf: {
    title: 'An and rule needs every check to pass',
    link: { label: 'PPL: and, or, not, nor', href: `${DOCS}/internals/ppl#logical-operators` },
  },
} as const

export type LessonId = keyof typeof LESSONS

export const LESSON_ORDER: readonly LessonId[] = [
  'every',
  'idp',
  'route',
  'authz',
  'claims',
  'refresh',
  'onroute',
  'request',
  'defaultDeny',
  'jwt',
  'verify',
  'allOf',
]

export const link = (lesson: LessonId) => LESSONS[lesson].link

/** What each gate's sign says above its route config. */
export const SIGN_TEXT: Partial<Record<SignId, string>> = {
  fields:
    "This gate is a route, and its guard follows the route's policy. Pomerium checks every request for this path against the policy below, and forwards the ones it allows to the app behind the route.",
  town: `The town only lets in citizens: people whose email domain is ${KINGDOM_DOMAIN}.`,
  guild: "The Knights' Guild hall. Any citizen may enter.",
  armory: 'Only knights. The guard reads the groups claim your identity provider put in your session.',
  library:
    'Two allow rules on one route. Citizens may read (GET); scribes may also write (POST). This guard lets readers in; the guard at the scriptorium checks writers.',
  scriptorium:
    'The scriptorium, where the Royal Ledger is written. Going in means writing, so this guard asks Pomerium with a POST. The readers rule only allows GET, so only the scribes rule can let you in.',
  keep: 'The Royal Keep. One rule, three checks: a citizen who is both a knight and a scholar. In an and rule, every check must pass.',
}

/** Where Pomerium documents the session and user records, and the cache in front of them. */
export const STALE_DOCS: readonly DocLink[] = [
  { label: 'Sessions: session and user data', href: `${DOCS}/internals/sessions#data` },
  { label: 'Persistence: the databroker and its caches', href: `${DOCS}/internals/data-storage#design` },
  LESSONS.claims.link,
]

export const SIGN_DOCS: Partial<Record<SignId, readonly DocLink[]>> = {
  fields: [
    link('route'),
    { label: 'authenticated_user', href: `${DOCS}/internals/ppl#supported-ppl-criteria` },
  ],
  town: [{ label: 'The domain criterion', href: `${DOCS}/internals/ppl#supported-ppl-criteria` }],
  guild: [link('route')],
  armory: [link('claims'), link('refresh')],
  library: [link('request'), { label: 'Path matching', href: `${DOCS}/reference/routes/path-matching` }],
  scriptorium: [link('request'), link('defaultDeny')],
  keep: [link('allOf'), link('claims')],
}

export const BOOKS: Page[] = [
  {
    who: 'Book · Default Deny',
    text: 'Pomerium allows a request only when an allow rule matches. Nothing matched means no entry. Nobody has to remember to lock a door.',
    links: [link('defaultDeny')],
  },
  {
    who: 'Book · The Guard’s Seal',
    text: 'When Pomerium lets a request through on a route with pass_identity_headers turned on, it adds a signed JWT in the X-Pomerium-Jwt-Assertion header. The app behind the route learns who you are without running its own login. Every gate in this kingdom turns it on.',
    links: [
      link('jwt'),
      { label: 'Pass identity headers', href: `${DOCS}/reference/routes/pass-identity-headers-per-route` },
    ],
  },
  {
    who: 'Book · Trust, But Verify',
    text: 'An app should check that seal against Pomerium’s public keys. If a request skipped Pomerium, there is no valid seal, and the app refuses it. This game’s server does exactly that.',
    links: [link('verify')],
  },
]

export const INTRO: Page[] = [
  {
    who: 'Pomerium Quest',
    text: 'Move with the arrow keys, or with the W, A, S and D keys (W up, A left, S down, D right). Press E or Enter to talk and read. Press Space or J to swing your sword.',
  },
  {
    who: 'Pomerium Quest',
    text: 'The sage in the house to your right has been waiting for you. Go say hello.',
  },
]
