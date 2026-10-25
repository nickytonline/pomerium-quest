// Everything the characters say, what the signs show and what each lesson links to.
import type { ZoneId } from './zones.ts'

const DOCS = 'https://www.pomerium.com/docs'

export interface DocLink {
  readonly label: string
  readonly href: string
}

export interface Page {
  readonly who: string
  readonly text: string
  readonly code?: string
  readonly links?: readonly DocLink[]
}

export const LESSONS = {
  every: {
    title: 'Every request is checked',
    link: { label: 'Zero trust', href: `${DOCS}/concepts/zero-trust` },
  },
  idp: {
    title: 'Your identity provider proves who you are',
    link: { label: 'OIDC identity providers', href: `${DOCS}/integrations/user-identity/oidc` },
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
    link: { label: 'PPL: the claim criterion', href: `${DOCS}/internals/ppl` },
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
    link: { label: 'PPL criteria', href: `${DOCS}/internals/ppl` },
  },
  defaultDeny: {
    title: 'No matching allow rule means no entry',
    link: { label: 'Policy language', href: `${DOCS}/internals/ppl` },
  },
  jwt: {
    title: 'Apps behind a route get a signed identity',
    link: { label: "Getting the user's identity", href: `${DOCS}/capabilities/getting-users-identity` },
  },
  verify: {
    title: 'Apps should verify that signature',
    link: { label: 'JWT verification', href: `${DOCS}/get-started/fundamentals/core/jwt-verification` },
  },
  notFound: {
    title: 'No route means no way through',
    link: { label: 'Route matching', href: `${DOCS}/reference/routes/from` },
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
  'notFound',
]

export const link = (lesson: LessonId) => LESSONS[lesson].link

/** What each gate's sign says above its route config. */
export const SIGN_TEXT: Partial<Record<ZoneId, string>> = {
  fields:
    'This gate is a route. Pomerium checks every request for this path against the policy below, then forwards it to the app behind the route.',
  town: 'The town only lets in citizens: people whose email domain is kingdom.com.',
  guild: "The Knights' Guild hall. Any citizen may enter.",
  armory: 'Only knights. The guard reads the groups claim your identity provider put in your session.',
  library:
    'Two allow rules on one route. Citizens may read (GET); scribes may also write (POST). Pomerium lets a request in when any rule matches.',
}

export const SIGN_DOCS: Partial<Record<ZoneId, readonly DocLink[]>> = {
  fields: [link('route'), { label: 'authenticated_user', href: `${DOCS}/internals/ppl` }],
  town: [{ label: 'The domain criterion', href: `${DOCS}/internals/ppl` }],
  guild: [link('route')],
  armory: [link('claims'), { label: 'Claim headers', href: `${DOCS}/reference/jwt-claim-headers` }],
  library: [link('request'), { label: 'Path matching', href: `${DOCS}/reference/routes/path-matching` }],
}

export const END_SIGN: Page[] = [
  {
    who: 'Sign · East Road',
    text: 'You have reached the edge of chapter one. Ahead: the Night Market (time-based rules), the Thieves’ Guild (device identity) and an owl familiar that acts for you over MCP.',
  },
  {
    who: 'Sign · East Road',
    text: 'Everything you walked through ran on a real Pomerium. The routes and policies on the signs are the same YAML in deploy/pomerium.',
    links: [{ label: 'Pomerium docs', href: DOCS }, link('route')],
  },
]

export const BOOKS: Page[] = [
  {
    who: 'Book · Default Deny',
    text: 'Pomerium allows a request only when an allow rule matches. Nothing matched means no entry. Nobody has to remember to lock a door.',
    links: [link('defaultDeny')],
  },
  {
    who: 'Book · The Guard’s Seal',
    text: 'When Pomerium lets a request through, it adds a signed JWT in the X-Pomerium-Jwt-Assertion header. The app behind the route learns who you are without running its own login.',
    links: [link('jwt')],
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
    text: 'Move with the arrow keys or WASD. Press E or Enter to talk and read. Press Space or J to swing your sword.',
  },
  {
    who: 'Pomerium Quest',
    text: 'The old man in the house to your right has been waiting for you. Go say hello.',
  },
]
