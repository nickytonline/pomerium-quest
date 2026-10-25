// The Oracle: a tiny OpenID Connect identity provider for Pomerium Quest.
//
// Pomerium signs players in against it exactly as it would against Google or Okta. The game
// server can add a group to a player through the admin API; the new claim reaches Pomerium
// the next time the player signs in, or when Pomerium next refreshes the session (refresh tokens
// are on, and access tokens last an hour). Signing in again is the lesson the game teaches.
import { generateKeyPairSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import Provider, { type Configuration, type KoaContextWithOIDC } from 'oidc-provider'
import { loginPage } from './login-page.ts'

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback

  if (value === undefined) throw new Error(`missing environment variable ${name}`)

  return value
}

const ISSUER = env('ORACLE_ISSUER', 'http://localhost:4000')
const PORT = Number(env('PORT', '4000'))
const CLIENT_ID = env('ORACLE_CLIENT_ID', 'pomerium')
const CLIENT_SECRET = env('ORACLE_CLIENT_SECRET', 'dev-only-client-secret')
const REDIRECT_URI = env('ORACLE_REDIRECT_URI', 'https://authenticate.localhost.pomerium.io/oauth2/callback')
const ADMIN_KEY = env('ORACLE_ADMIN_KEY', 'dev-only-oracle-key')
const COOKIE_KEY = env('ORACLE_COOKIE_KEY', 'dev-only-cookie-key')

/** Groups granted by the game, keyed by email, saved to ORACLE_DATA_FILE when it is set. */
const DATA_FILE = process.env['ORACLE_DATA_FILE']

function loadGroups() {
  const loaded = new Map<string, Set<string>>()

  if (!DATA_FILE || !existsSync(DATA_FILE)) return loaded

  try {
    const saved = new Map<string, string[]>(Object.entries(JSON.parse(readFileSync(DATA_FILE, 'utf8'))))

    for (const [email, list] of saved) loaded.set(email, new Set(list.map(String)))
  } catch (error) {
    console.error(`could not read ${DATA_FILE}; starting with no groups`, error)
  }

  return loaded
}

function saveGroups() {
  if (!DATA_FILE) return

  const data = Object.fromEntries([...groups].map(([email, set]) => [email, [...set]]))

  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

const groups = loadGroups()

const groupsFor = (email: string) => [...(groups.get(email) ?? [])].sort()

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })

const configuration: Configuration = {
  clients: [
    {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  ],
  scopes: ['openid', 'email', 'profile', 'groups', 'offline_access'],
  claims: {
    openid: ['sub'],
    email: ['email', 'email_verified'],
    profile: ['name'],
    groups: ['groups'],
  },
  // Put the claims in the ID token itself, not only behind the userinfo endpoint.
  conformIdTokenClaims: false,
  findAccount: (_ctx, id) => ({
    accountId: id,
    claims: () => ({
      sub: id,
      email: id,
      email_verified: true,
      name: id.split('@')[0] ?? id,
      groups: groupsFor(id),
    }),
  }),
  // Pomerium is the only client and it is first-party: skip the consent screen by
  // granting every requested scope and claim.
  loadExistingGrant: async (ctx: KoaContextWithOIDC) => {
    const { client, session } = ctx.oidc

    if (!client || !session?.accountId) return undefined

    const existing = session.grantIdFor(client.clientId)
    const found = existing ? await ctx.oidc.provider.Grant.find(existing) : undefined

    if (found) return found

    const grant = new ctx.oidc.provider.Grant({ clientId: client.clientId, accountId: session.accountId })

    grant.addOIDCScope('openid email profile groups offline_access')
    grant.addOIDCClaims(['email', 'email_verified', 'name', 'groups'])
    await grant.save()

    return grant
  },
  interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
  features: {
    devInteractions: { enabled: false },
    // Without an end_session endpoint, signing out of Pomerium keeps the Oracle session, so
    // signing back in is instant and picks up any new groups.
    rpInitiatedLogout: { enabled: false },
  },
  cookies: { keys: [COOKIE_KEY] },
  jwks: { keys: [privateKey.export({ format: 'jwk' })] },
  ttl: { AccessToken: 3600, IdToken: 3600, Session: 86_400, Grant: 86_400 },
}

const provider = new Provider(ISSUER, configuration)

// TLS ends at Pomerium; trust its X-Forwarded-* headers so cookies and URLs use https.
provider.proxy = true

const oidc = provider.callback()

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of req) chunks.push(Buffer.from(chunk))

  return Buffer.concat(chunks).toString('utf8')
}

function send(res: ServerResponse, status: number, contentType: string, body: string) {
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}

const sendJson = (res: ServerResponse, status: number, body: string) =>
  send(res, status, 'application/json', body)

function adminAllowed(req: IncomingMessage) {
  const given = Buffer.from(String(req.headers['x-oracle-key'] ?? ''))
  const expected = Buffer.from(ADMIN_KEY)

  return given.length === expected.length && timingSafeEqual(given, expected)
}

interface GrantRequest {
  readonly email: string
  readonly group: string
}

/** The admin API takes a form-encoded body: email=...&group=... */
function parseGrant(body: string): GrantRequest | undefined {
  const params = new URLSearchParams(body)
  const email = (params.get('email') ?? '').trim().toLowerCase()
  const group = params.get('group') ?? ''

  return email.includes('@') && /^[a-z][a-z0-9-]*$/.test(group) ? { email, group } : undefined
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', ISSUER)
  const interaction = /^\/interaction\/([\w-]+)(\/login)?$/.exec(url.pathname)

  if (url.pathname === '/healthz') return send(res, 200, 'text/plain', 'ok')

  if (interaction && req.method === 'GET' && !interaction[2]) {
    const details = await provider.interactionDetails(req, res)

    return send(res, 200, 'text/html; charset=utf-8', loginPage(details.uid))
  }

  if (interaction && req.method === 'POST' && interaction[2]) {
    const form = new URLSearchParams(await readBody(req))
    const email = (form.get('email') ?? '').trim().toLowerCase()

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return send(
        res,
        400,
        'text/html; charset=utf-8',
        loginPage(interaction[1] ?? '', 'That is not an email address.'),
      )
    }

    return provider.interactionFinished(
      req,
      res,
      { login: { accountId: email } },
      { mergeWithLastSubmission: false },
    )
  }

  if (url.pathname === '/admin/grants' && req.method === 'POST') {
    if (!adminAllowed(req)) return sendJson(res, 401, '{"error":"bad admin key"}')

    const grant = parseGrant(await readBody(req))

    if (!grant) return sendJson(res, 400, '{"error":"expected email=...&group=..."}')

    const current = groups.get(grant.email) ?? new Set<string>()

    current.add(grant.group)
    groups.set(grant.email, current)
    saveGroups()
    console.log(`granted ${grant.group} to ${grant.email}`)

    return sendJson(res, 200, JSON.stringify({ email: grant.email, groups: groupsFor(grant.email) }))
  }

  if (url.pathname === '/admin/users' && req.method === 'GET') {
    if (!adminAllowed(req)) return sendJson(res, 401, '{"error":"bad admin key"}')

    return sendJson(
      res,
      200,
      JSON.stringify(Object.fromEntries([...groups].map(([email, set]) => [email, [...set]]))),
    )
  }

  return oidc(req, res)
}

createServer((req, res) => {
  handle(req, res).catch((error: Error) => {
    console.error(error)

    if (!res.headersSent) send(res, 500, 'text/plain', 'The Oracle stumbled. Check the logs.')
  })
}).listen(PORT, () => console.log(`Oracle listening on :${PORT} as ${ISSUER}`))
