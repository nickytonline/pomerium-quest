// Everything the characters say, what the signs show and what each lesson links to.
import type { Knocker } from './house.ts'
import type { LetterStage } from './house-machine.ts'
import type { ZoneId } from './zones.ts'

/** Every gate has a sign, named for the zone whose route it guards. */
export type SignId = ZoneId

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
  publicRoute: {
    title: 'A public route lets everyone in',
    link: { label: 'Public access', href: `${DOCS}/reference/routes/public-access` },
  },
  writePolicy: {
    title: 'You write the policy',
    link: { label: 'Route policy', href: `${DOCS}/reference/routes/policy` },
  },
  anyOf: {
    title: 'An or rule lets in anyone who passes one check',
    link: { label: 'PPL: and, or, not, nor', href: `${DOCS}/internals/ppl#logical-operators` },
  },
  denyWins: {
    title: 'A deny rule always beats an allow',
    link: { label: 'PPL: allow and deny', href: `${DOCS}/internals/ppl#actions` },
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
  'publicRoute',
  'writePolicy',
  'anyOf',
  'denyWins',
]

export const link = (lesson: LessonId) => LESSONS[lesson].link

/** What each gate's sign says above its route config. */
export const SIGN_TEXT: Partial<Record<SignId, string>> = {
  fields:
    "This gate is a route, and its guard follows the route's policy. Pomerium checks every request for this path against the policy below, and forwards the ones it allows to the app behind the route.",
  town: 'The town only lets in citizens: people the Oracle has put in the citizen group.',
  guild: "The Knights' Guild hall. Any citizen may enter.",
  armory: 'Only knights. The guard reads the groups claim your identity provider put in your session.',
  library:
    "The Royal Library. Citizens may read here, and that's all: the rule below checks the request's method as well as who sent it, so it allows a GET and nothing else.",
  scriptorium:
    "The scriptorium, where the Royal Ledger is written. Its path is inside the library's, but it's a route of its own with its own policy. Pomerium picks the route whose path matches most closely, so the library's rule doesn't apply here: only scribes may enter.",
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
  library: [link('request')],
  scriptorium: [
    { label: 'Path matching', href: `${DOCS}/reference/routes/path-matching` },
    link('defaultDeny'),
  ],
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

/** Who knocks in a letter's test: a townsperson, a slime, or the player at their own door. */
export type Caller = Knocker | 'you'

/** One visit a letter asks for, and whether Pomerium should let it in. */
export interface Expectation {
  readonly who: Caller
  readonly method: 'GET' | 'POST'
  readonly allowed: boolean
}

export interface Letter {
  readonly title: string
  readonly text: string
  /** The visits that must come out this way, through the real Pomerium, for the letter to be solved. */
  readonly expect: readonly Expectation[]
  /** The answer must use a deny rule, since that's what the letter teaches. */
  readonly needsDeny?: boolean
  /** Taught when the letter is solved. */
  readonly lesson: LessonId
  /** What the house says once it's solved. */
  readonly solved: string
}

const visit = (who: Caller, allowed: boolean, method: 'GET' | 'POST' = 'GET'): Expectation => ({
  who,
  method,
  allowed,
})

/** The letters left on the player's desk, in order. Each is a small brief for the door rules. */
export const LETTERS: Record<LetterStage, Letter> = {
  slimes: {
    title: 'Slimes in the house!',
    text: "Welcome home! The builders left your door wide open: its route has allow_public_unauthenticated_access, so Pomerium lets in every request, even ones with no session at all. That's how the slimes got in. The traveler is a friend, though, so they can stay. Write a door rule at the desk that lets in the traveler. You need no rule for yourself: your deed already lets you in. Once Pomerium takes it up, your visitors will try the door.",
    expect: [visit('you', true), visit('traveler', true), visit('slime', false)],
    lesson: 'anyOf',
    solved:
      "The slimes bounce off the door: with no session, they can't match any rule. The traveler is still welcome to drop by for bread.",
  },
  bread: {
    title: 'The traveler ate all your bread',
    text: "Every last crumb. Change your door so only you can come in. You don't need a rule to keep the traveler out: take their rule away, and once no rule matches them, Pomerium says no. Your deed still lets you in.",
    expect: [visit('you', true), visit('traveler', false), visit('slime', false)],
    lesson: 'defaultDeny',
    solved: 'The traveler tries the door, shrugs and wanders back to the fields. No rule matches them now.',
  },
  guild: {
    title: 'A letter from the Captain',
    text: '"The knights would like to visit." Let in anyone in the knights group. Your door can read the groups claim, just like the armory\'s guard.',
    expect: [
      visit('you', true),
      visit('captain', true),
      visit('librarian', false),
      visit('traveler', false),
      visit('slime', false),
    ],
    lesson: 'claims',
    solved: 'The Captain wipes their boots and comes in. The groups claim said knights.',
  },
  baker: {
    title: 'Open house',
    text: `Open your door to every citizen, except the baker, who keeps bringing bread you've no room for. Use a deny rule for the baker: a deny always wins, even when an allow rule matches too.`,
    expect: [
      visit('you', true),
      visit('captain', true),
      visit('librarian', true),
      visit('baker', false),
      visit('traveler', false),
      visit('slime', false),
    ],
    needsDeny: true,
    lesson: 'denyWins',
    solved: 'The baker matches your allow rule, but your deny rule matches them too, and a deny always wins.',
  },
  window: {
    title: 'Looking in, not knocking',
    text: 'The knights may look in through the window (a GET), but only you may knock on the door (a POST). A rule can check the request itself, as the library does.',
    expect: [
      visit('you', true),
      visit('you', true, 'POST'),
      visit('captain', true),
      visit('captain', false, 'POST'),
      visit('slime', false),
    ],
    lesson: 'request',
    solved:
      'The Captain peers in and waves, but the knocker stays still for them. Your house is all yours now.',
  },
}
