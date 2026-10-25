// Renders the Pomerium config and the Kubernetes manifests from app/src/game/zones.ts, so the
// policies Pomerium enforces are the same ones the game shows on its signs.
//
//   node scripts/render.ts            → deploy/.generated/*.yaml
//
// Environment: QUEST_DOMAIN (default localhost.pomerium.io), QUEST_PORT (default 443), and
// QUEST_DEV=1 to run the game's Vite dev server from the source mounted into the cluster.
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { ZONES, type AllowRule, type Criterion } from '../app/src/game/zones.ts'

type Yaml = string | number | boolean | readonly Yaml[] | { readonly [key: string]: Yaml }

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'deploy/.generated')
const STATE = join(ROOT, '.quest')
const NAMESPACE = 'quest'
const POMERIUM_IMAGE = 'pomerium/pomerium:v0.33.4'
const APP_IMAGE = 'pomerium-quest/app:dev'
const APP_DEV_IMAGE = 'pomerium-quest/app-dev:dev'

/** Where `./quest up` mounts this repo inside the k3d node. */
const NODE_SOURCE = '/quest-src'

/** The Oracle is Keycloak, with its own realm and a login theme that matches the game. */
const KEYCLOAK_IMAGE = 'quay.io/keycloak/keycloak:26.7.5'
const REALM = 'kingdom'
const THEME = join(ROOT, 'deploy/keycloak/theme')

const THEME_FILES = [
  'login/theme.properties',
  'login/messages/messages_en.properties',
  'login/resources/css/quest.css',
]

const DOMAIN = process.env['QUEST_DOMAIN'] ?? 'localhost.pomerium.io'
const PORT = Number(process.env['QUEST_PORT'] ?? '443')
const DEV = process.env['QUEST_DEV'] === '1'
const hostPort = PORT === 443 ? '' : `:${PORT}`
const publicUrl = (subdomain: string) => `https://${subdomain}.${DOMAIN}${hostPort}`
const svc = (name: string, port: number) => `http://${name}.${NAMESPACE}.svc.cluster.local:${port}`
const oracleIssuer = `${publicUrl('oracle')}/realms/${REALM}`

interface Secrets {
  readonly sharedSecret: string
  readonly cookieSecret: string
  readonly signingKey: string
  /** Pomerium's client secret at Keycloak. */
  readonly clientSecret: string
  /** The game's client secret at Keycloak, for adding players to groups. */
  readonly questClientSecret: string
  /** Keycloak's own admin console (master realm), reached with `./quest admin`. */
  readonly keycloakAdminPassword: string
}

/**
 * Secrets are generated once and kept in .quest/ so sessions survive a re-render. Secrets added
 * since the file was written are generated and saved alongside the old ones.
 */
function loadSecrets(): Secrets {
  const file = join(STATE, 'secrets.json')

  // SAFETY: written by this function below and never edited by hand.
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<Secrets>) : {}

  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

  const secrets: Secrets = {
    sharedSecret: saved.sharedSecret ?? randomBytes(32).toString('base64'),
    cookieSecret: saved.cookieSecret ?? randomBytes(32).toString('base64'),
    signingKey: saved.signingKey ?? Buffer.from(pem).toString('base64'),
    clientSecret: saved.clientSecret ?? randomBytes(24).toString('hex'),
    questClientSecret: saved.questClientSecret ?? randomBytes(24).toString('hex'),
    keycloakAdminPassword: saved.keycloakAdminPassword ?? randomBytes(12).toString('hex'),
  }

  mkdirSync(STATE, { recursive: true })
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 })

  return secrets
}

/** A criterion as the YAML structure Pomerium reads. */
function criterion(node: Criterion): Yaml {
  switch (node.kind) {
    case 'authenticated_user':
      return { authenticated_user: true }
    case 'claim':
      return { [`claim/${node.claim}`]: node.value }
    case 'domain':
    case 'email':
    case 'http_method':
      return { [node.kind]: { is: node.is } }
  }
}

/** A route policy: a list of allow rules, any of which lets the request through. */
const policy = (rules: readonly AllowRule[]): Yaml =>
  rules.map((rule) => ({ allow: { [rule.match]: rule.criteria.map(criterion) } }))

const toYaml = (value: Yaml) => stringify(value, { lineWidth: 0 }).trimEnd()

function pomeriumConfig(secrets: Secrets): Yaml {
  const app = svc('quest', 3000)
  const game = publicUrl('game')

  return {
    address: ':8443',
    authenticate_service_url: publicUrl('authenticate'),
    // After signing out, go straight back to sign-in: the new session carries fresh claims.
    // This is how the game refreshes a player's groups.
    signout_redirect_url: `${game}/zones/oracle/signin`,
    // Restarting the game signs out to the title screen instead, through pomerium_redirect_uri.
    runtime_flags: { allow_any_sign_out_redirect_uri: true },
    idp_provider: 'oidc',
    idp_provider_url: oracleIssuer,
    idp_client_id: 'pomerium',
    idp_client_secret: secrets.clientSecret,
    // Keycloak adds the groups claim through a mapper on Pomerium's client, not through a scope.
    idp_scopes: ['openid', 'email', 'profile'],
    shared_secret: secrets.sharedSecret,
    cookie_secret: secrets.cookieSecret,
    signing_key: secrets.signingKey,
    certificate_file: '/certs/tls.crt',
    certificate_key_file: '/certs/tls.key',
    // Forward the identity provider's groups claim to the app as a header too.
    jwt_claims_headers: { 'X-Pomerium-Claim-Groups': 'groups' },
    routes: [
      // Only the game's realm and Keycloak's static files are public. The admin console and the
      // master realm stay inside the cluster (`./quest admin` forwards a port to them).
      ...[`/realms/${REALM}/`, '/resources/'].map((prefix) => ({
        from: publicUrl('oracle'),
        prefix,
        to: svc('keycloak', 8080),
        allow_public_unauthenticated_access: true,
        preserve_host_header: true,
        // The game opens the Oracle's sign-in page in a frame, so the player never leaves the
        // game. Browsers let frame-ancestors override X-Frame-Options.
        set_response_headers: {
          'Content-Security-Policy': `frame-src 'self'; frame-ancestors 'self' ${game}; object-src 'none';`,
        },
      })),
      // One route per zone: same host, its own path prefix, its own policy.
      ...ZONES.map((zone) => ({
        from: game,
        prefix: zone.prefix,
        to: app,
        pass_identity_headers: true,
        policy: policy(zone.policy),
      })),
      // Everything else (the game shell and its assets) is public.
      // In dev it also carries Vite's hot-reload websocket.
      {
        from: game,
        to: app,
        allow_public_unauthenticated_access: true,
        pass_identity_headers: true,
        allow_websockets: DEV,
      },
    ],
  }
}

const labels = (name: string) => ({ app: name })

/** The game's source folders the dev server serves straight from the host. */
const DEV_SOURCES = ['src', 'public']
const devVolume = (dir: string) => `dev-${dir}`

const caVolume: Yaml = {
  name: 'certs',
  secret: { secretName: 'quest-tls', items: [{ key: 'ca.crt', path: 'ca.crt' }] },
}

function deployment(
  name: string,
  image: string,
  port: number,
  extra: { [key: string]: Yaml },
  pod: { [key: string]: Yaml },
  strategy: 'RollingUpdate' | 'Recreate' = 'RollingUpdate',
): Yaml {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace: NAMESPACE, labels: labels(name) },
    spec: {
      replicas: 1,
      strategy: { type: strategy },
      selector: { matchLabels: labels(name) },
      template: {
        metadata: { labels: labels(name) },
        spec: {
          containers: [
            {
              name,
              image,
              imagePullPolicy: image.startsWith('pomerium-quest/') ? 'Never' : 'IfNotPresent',
              ports: [{ containerPort: port }],
              ...extra,
            },
          ],
          ...pod,
        },
      },
    },
  }
}

function service(name: string, port: number, targetPort: number, type = 'ClusterIP'): Yaml {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name, namespace: NAMESPACE },
    spec: { type, selector: labels(name), ports: [{ name: 'http', port, targetPort }] },
  }
}

/** ConfigMap keys can't hold slashes: login/resources/css/quest.css → login.resources.css.quest.css */
const themeKey = (file: string) => file.replace(/\//g, '.')

const secretEnv = (name: string, key: string) => ({
  name,
  valueFrom: { secretKeyRef: { name: 'quest-secrets', key } },
})

/** Registration asks only for an email and a password: no first and last name. */
const userProfile = {
  attributes: [
    {
      name: 'username',
      displayName: '${username}',
      validations: {
        length: { min: 3, max: 255 },
        'username-prohibited-characters': {},
        'up-username-not-idn-homograph': {},
      },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
      multivalued: false,
    },
    {
      name: 'email',
      displayName: '${email}',
      validations: { email: {}, length: { max: 255 } },
      required: { roles: ['user'] },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
      multivalued: false,
    },
  ],
}

/**
 * The game's Keycloak realm. Keycloak imports it on first start only; after that the realm
 * (and every player in it) lives in Keycloak's database. `./quest reset-oracle` starts over.
 */
function realm(secrets: Secrets): Yaml {
  const game = publicUrl('game')

  return {
    realm: REALM,
    enabled: true,
    displayName: 'The Oracle',
    displayNameHtml: '<div class="kc-logo-text"><span>The Oracle</span></div>',
    loginTheme: 'quest',
    // Anyone may sign up with any email, unverified: the address decides what the game lets
    // them reach (kingdom.com citizens get into town). Never reuse this realm for anything real.
    registrationAllowed: true,
    registrationEmailAsUsername: true,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    verifyEmail: false,
    resetPasswordAllowed: false,
    rememberMe: false,
    sslRequired: 'external',
    groups: [{ name: 'knights' }, { name: 'scholars' }],
    clients: [
      {
        clientId: 'pomerium',
        name: 'Pomerium',
        enabled: true,
        publicClient: false,
        secret: secrets.clientSecret,
        standardFlowEnabled: true,
        directAccessGrantsEnabled: false,
        redirectUris: [`${publicUrl('authenticate')}/oauth2/callback`],
        attributes: { 'post.logout.redirect.uris': `${game}/*##${publicUrl('authenticate')}/*` },
        protocolMappers: [
          {
            name: 'groups',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-group-membership-mapper',
            config: {
              'claim.name': 'groups',
              'full.path': 'false',
              'id.token.claim': 'true',
              'access.token.claim': 'true',
              'userinfo.token.claim': 'true',
              'introspection.token.claim': 'true',
            },
          },
        ],
      },
      {
        // The game server's own client: it may look up players and add them to groups.
        clientId: 'quest-admin',
        name: 'Pomerium Quest',
        enabled: true,
        publicClient: false,
        secret: secrets.questClientSecret,
        standardFlowEnabled: false,
        directAccessGrantsEnabled: false,
        serviceAccountsEnabled: true,
      },
    ],
    users: [
      {
        username: 'service-account-quest-admin',
        enabled: true,
        serviceAccountClientId: 'quest-admin',
        clientRoles: { 'realm-management': ['view-users', 'manage-users', 'query-groups'] },
      },
    ],
    components: {
      'org.keycloak.userprofile.UserProfileProvider': [
        {
          providerId: 'declarative-user-profile',
          subComponents: {},
          config: { 'kc.user.profile.config': [JSON.stringify(userProfile)] },
        },
      ],
    },
  }
}

function manifests(secrets: Secrets): Yaml[] {
  const escapedDomain = DOMAIN.replace(/\./g, '\\.')

  return [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: NAMESPACE } },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'quest-secrets', namespace: NAMESPACE },
      stringData: {
        'quest-client-secret': secrets.questClientSecret,
        'keycloak-admin-password': secrets.keycloakAdminPassword,
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'pomerium-config', namespace: NAMESPACE },
      stringData: { 'config.yaml': `${toYaml(pomeriumConfig(secrets))}\n` },
    },
    deployment(
      'pomerium',
      POMERIUM_IMAGE,
      8443,
      {
        args: ['-config', '/pomerium/config.yaml'],
        env: [{ name: 'SSL_CERT_DIR', value: '/etc/ssl/certs:/certs' }],
        volumeMounts: [
          { name: 'config', mountPath: '/pomerium', readOnly: true },
          { name: 'certs', mountPath: '/certs', readOnly: true },
        ],
      },
      {
        volumes: [
          { name: 'config', secret: { secretName: 'pomerium-config' } },
          { name: 'certs', secret: { secretName: 'quest-tls' } },
        ],
      },
    ),
    service('pomerium', PORT, 8443, 'LoadBalancer'),
    deployment(
      'quest',
      DEV ? APP_DEV_IMAGE : APP_IMAGE,
      3000,
      {
        env: [
          { name: 'QUEST_MODE', value: 'pomerium' },
          { name: 'QUEST_PUBLIC_ORIGIN', value: publicUrl('game') },
          { name: 'KEYCLOAK_URL', value: svc('keycloak', 8080) },
          { name: 'KEYCLOAK_REALM', value: REALM },
          { name: 'KEYCLOAK_CLIENT_ID', value: 'quest-admin' },
          secretEnv('KEYCLOAK_CLIENT_SECRET', 'quest-client-secret'),
          { name: 'NODE_EXTRA_CA_CERTS', value: '/certs/ca.crt' },
          ...(DEV ? [{ name: 'QUEST_HMR_PORT', value: String(PORT) }] : []),
        ],
        volumeMounts: [
          { name: 'certs', mountPath: '/certs', readOnly: true },
          ...(DEV ? DEV_SOURCES.map((dir) => ({ name: devVolume(dir), mountPath: `/repo/app/${dir}` })) : []),
        ],
        readinessProbe: { httpGet: { path: '/', port: 3000 }, periodSeconds: 3 },
      },
      {
        volumes: [
          caVolume,
          ...(DEV
            ? DEV_SOURCES.map((dir) => ({
                name: devVolume(dir),
                hostPath: { path: `${NODE_SOURCE}/app/${dir}`, type: 'Directory' },
              }))
            : []),
        ],
      },
    ),
    service('quest', 3000, 3000),
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'keycloak-realm', namespace: NAMESPACE },
      stringData: { [`${REALM}-realm.json`]: JSON.stringify(realm(secrets), null, 2) },
    },
    {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'keycloak-theme', namespace: NAMESPACE },
      data: Object.fromEntries(
        THEME_FILES.map((file) => [themeKey(file), readFileSync(join(THEME, file), 'utf8')]),
      ),
    },
    deployment(
      'keycloak',
      KEYCLOAK_IMAGE,
      8080,
      {
        // Dev mode: an embedded H2 database on a volume, and no theme caching, so edits to
        // deploy/keycloak/theme show up after `./quest deploy`. Use a real database in production.
        args: ['start-dev', '--import-realm'],
        env: [
          { name: 'KC_HOSTNAME', value: publicUrl('oracle') },
          // `./quest admin` forwards this port to reach the admin console.
          { name: 'KC_HOSTNAME_ADMIN', value: 'http://localhost:8080' },
          // TLS ends at Pomerium; trust its X-Forwarded-* headers.
          { name: 'KC_PROXY_HEADERS', value: 'xforwarded' },
          { name: 'KC_HEALTH_ENABLED', value: 'true' },
          { name: 'KC_BOOTSTRAP_ADMIN_USERNAME', value: 'admin' },
          secretEnv('KC_BOOTSTRAP_ADMIN_PASSWORD', 'keycloak-admin-password'),
        ],
        volumeMounts: [
          { name: 'data', mountPath: '/opt/keycloak/data/h2' },
          { name: 'realm', mountPath: '/opt/keycloak/data/import', readOnly: true },
          { name: 'theme', mountPath: '/opt/keycloak/themes/quest', readOnly: true },
        ],
        readinessProbe: { httpGet: { path: '/health/ready', port: 9000 }, periodSeconds: 5 },
      },
      {
        // Players, their passwords and their groups live on this volume, so a redeploy keeps them.
        volumes: [
          { name: 'data', persistentVolumeClaim: { claimName: 'keycloak-data' } },
          { name: 'realm', secret: { secretName: 'keycloak-realm' } },
          {
            name: 'theme',
            configMap: {
              name: 'keycloak-theme',
              items: THEME_FILES.map((file) => ({ key: themeKey(file), path: file })),
            },
          },
        ],
        securityContext: { fsGroup: 1000 },
      },
      // H2 locks its database file, so the old pod must stop before the new one starts.
      'Recreate',
    ),
    service('keycloak', 8080, 8080),
    {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: 'keycloak-data', namespace: NAMESPACE },
      spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '256Mi' } } },
    },
    // Only Pomerium may reach the game; only Pomerium and the game may reach the Oracle.
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: 'quest-only-via-pomerium', namespace: NAMESPACE },
      spec: {
        podSelector: { matchLabels: labels('quest') },
        policyTypes: ['Ingress'],
        ingress: [{ from: [{ podSelector: { matchLabels: labels('pomerium') } }] }],
      },
    },
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: 'keycloak-from-pomerium-and-quest', namespace: NAMESPACE },
      spec: {
        podSelector: { matchLabels: labels('keycloak') },
        policyTypes: ['Ingress'],
        ingress: [
          {
            from: [
              { podSelector: { matchLabels: labels('pomerium') } },
              { podSelector: { matchLabels: labels('quest') } },
            ],
          },
        ],
      },
    },
    // Inside the cluster, *.localhost.pomerium.io would resolve to the pod itself. Send it to
    // Pomerium instead, so Pomerium can reach the Oracle and the game can fetch Pomerium's JWKS.
    {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'coredns-custom', namespace: 'kube-system' },
      data: {
        'quest.override': `rewrite name regex (.*)\\.${escapedDomain} pomerium.${NAMESPACE}.svc.cluster.local answer auto\n`,
      },
    },
  ]
}

const secrets = loadSecrets()

mkdirSync(OUT, { recursive: true })

writeFileSync(join(OUT, 'pomerium-config.yaml'), `${toYaml(pomeriumConfig(secrets))}\n`)

writeFileSync(
  join(OUT, 'manifests.yaml'),
  `${manifests(secrets)
    .map((doc) => toYaml(doc))
    .join('\n---\n')}\n`,
)

console.log(`rendered ${OUT}/manifests.yaml for ${publicUrl('game')}`)
