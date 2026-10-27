// Renders the Kubernetes manifests from app/src/game/zones.ts: the Pomerium Ingress Controller, its
// global settings and one Ingress per zone, so the policies Pomerium enforces are the same ones the
// game shows on its signs.
//
//   node scripts/render.ts            → deploy/.generated/pomerium.yaml and manifests.yaml
//
// Environment: QUEST_DOMAIN (default localhost.pomerium.io), QUEST_PORT (default 443),
// and QUEST_DEV=1 to run the game's Vite dev server from the source mounted into the cluster.
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments, stringify } from 'yaml'
import { VISITORS, VISITOR_IDS, visitorPassword } from '../app/src/game/house.ts'
import { policyDocument } from '../app/src/game/ppl.ts'
import { ZONES } from '../app/src/game/zones.ts'

type Yaml = string | number | boolean | readonly Yaml[] | { readonly [key: string]: Yaml }

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'deploy/.generated')
const STATE = join(ROOT, '.quest')
const NAMESPACE = 'quest'

/** Where the game writes players' houses: one Ingress each, and nothing else (docs/prd/your-house.md). */
const HOUSES_NAMESPACE = 'quest-houses'

/** How many houses may stand at once; the PRD's load test is behind the number. */
const HOUSE_LIMIT = 100

/** Where the Ingress Controller runs: Pomerium itself, reading routes from Ingresses. */
const POMERIUM_NAMESPACE = 'pomerium'

/**
 * The Ingress Controller's install, pinned to the release that embeds Pomerium v0.33.4. Regenerate with
 * kubectl kustomize 'github.com/pomerium/ingress-controller/config/default?ref=0-33-0'.
 */
const CONTROLLER = join(ROOT, 'deploy/pomerium/ingress-controller.yaml')
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
  /** The start of the townsfolk's passwords at the Oracle, for knocking on players' houses. */
  readonly visitorPassword: string
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
    visitorPassword: saved.visitorPassword ?? randomBytes(18).toString('hex'),
  }

  mkdirSync(STATE, { recursive: true })
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 })

  return secrets
}

const toYaml = (value: Yaml) => stringify(value, { lineWidth: 0 }).trimEnd()

const ANNOTATION = 'ingress.pomerium.io'

/** Pomerium route options as Ingress annotations. Structured values (maps, policies) are YAML strings. */
const annotations = (options: { readonly [key: string]: string }) =>
  Object.fromEntries(Object.entries(options).map(([key, value]) => [`${ANNOTATION}/${key}`, value]))

interface IngressPath {
  readonly path: string
  readonly service: string
  readonly port: number
}

function ingress(
  name: string,
  host: string,
  paths: readonly IngressPath[],
  options: { readonly [key: string]: string },
): Yaml {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name, namespace: NAMESPACE, annotations: annotations(options) },
    spec: {
      ingressClassName: 'pomerium',
      rules: [
        {
          host,
          http: {
            paths: paths.map(({ path, service, port }) => ({
              path,
              pathType: 'Prefix',
              backend: { service: { name: service, port: { number: port } } },
            })),
          },
        },
      ],
    },
  }
}

/** Pomerium's global settings. Routes come from the Ingresses below, not from here. */
function pomeriumSettings(): Yaml {
  return {
    apiVersion: 'ingress.pomerium.io/v1',
    kind: 'Pomerium',
    metadata: { name: 'global' },
    spec: {
      secrets: `${POMERIUM_NAMESPACE}/bootstrap`,
      authenticate: { url: publicUrl('authenticate') },
      identityProvider: {
        provider: 'oidc',
        url: oracleIssuer,
        secret: `${POMERIUM_NAMESPACE}/idp`,
        // Keycloak adds the groups claim through a mapper on Pomerium's client, not through a scope.
        scopes: ['openid', 'email', 'profile'],
      },
      certificates: [`${POMERIUM_NAMESPACE}/quest-tls`],
      // Pomerium fetches the Oracle's sign-in metadata over HTTPS, signed by the local mkcert CA.
      caSecrets: [`${POMERIUM_NAMESPACE}/quest-ca`],
      // Signing out can land anywhere in the game: back at sign-in to refresh claims, or at the title
      // screen to start over (see app/src/game/access.ts).
      runtimeFlags: { allow_any_sign_out_redirect_uri: true },
      // Forward the identity provider's groups claim to the app as a header too.
      jwtClaimHeaders: { 'X-Pomerium-Claim-Groups': 'groups', 'X-Pomerium-Claim-Deed': 'deed' },
    },
  }
}

function routes(): Yaml[] {
  const game = publicUrl('game')
  const gameHost = new URL(game).hostname
  const app = { service: 'quest', port: 3000 }

  return [
    // Only the game's realm and Keycloak's static files are public. The admin console and the master
    // realm stay inside the cluster (`./quest admin` forwards a port to them).
    ingress(
      'oracle',
      new URL(publicUrl('oracle')).hostname,
      [`/realms/${REALM}/`, '/resources/'].map((path) => ({ path, service: 'keycloak', port: 8080 })),
      {
        allow_public_unauthenticated_access: 'true',
        preserve_host_header: 'true',
        // The game opens the Oracle's sign-in page in a frame, so the player never leaves the game.
        // Browsers let frame-ancestors override X-Frame-Options.
        set_response_headers: JSON.stringify({
          'Content-Security-Policy': `frame-src 'self'; frame-ancestors 'self' ${game}; object-src 'none';`,
        }),
      },
    ),
    // One route per zone: same host, its own path prefix, its own policy.
    ...ZONES.map((zone) =>
      ingress(`zone-${zone.id}`, gameHost, [{ path: zone.prefix, ...app }], {
        pass_identity_headers: 'true',
        policy: stringify(policyDocument(zone.policy), { lineWidth: 0 }).trimEnd(),
      }),
    ),
    // Everything else (the game shell and its assets) is public. In dev it also carries Vite's
    // hot-reload websocket.
    ingress('game', gameHost, [{ path: '/', ...app }], {
      allow_public_unauthenticated_access: 'true',
      pass_identity_headers: 'true',
      allow_websockets: String(DEV),
    }),
  ]
}

/** The controller's manifests it would make itself: its secrets (written below) and its load balancer. */
const REPLACED = new Set(['pomerium-gen-secrets', 'pomerium-proxy'])

/** The controller's install, with the k3d load balancer sending QUEST_PORT to Pomerium's HTTPS port. */
function controller(): Yaml[] {
  const kept = parseAllDocuments(readFileSync(CONTROLLER, 'utf8')).filter(
    (doc) => !REPLACED.has(String(doc.getIn(['metadata', 'name']))),
  )

  // SAFETY: the vendored install is plain Kubernetes YAML: maps, lists, strings, numbers and booleans.
  const docs = kept.map((doc) => doc.toJS() as Yaml)

  const proxy = { 'app.kubernetes.io/name': 'pomerium', 'app.kubernetes.io/component': 'proxy' }

  return [
    ...docs,
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'pomerium-proxy', namespace: POMERIUM_NAMESPACE, labels: proxy },
      spec: {
        type: 'LoadBalancer',
        selector: proxy,
        ports: [{ name: 'https', port: PORT, protocol: 'TCP', targetPort: 'https' }],
      },
    },
  ]
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

/** Puts the deed attribute into the session as the `deed` claim. */
const deedMapper = {
  name: 'deed',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-attribute-mapper',
  config: {
    'user.attribute': 'deed',
    'claim.name': 'deed',
    'jsonType.label': 'String',
    'id.token.claim': 'true',
    'access.token.claim': 'true',
    'userinfo.token.claim': 'true',
    'introspection.token.claim': 'true',
  },
}

/**
 * Registration asks only for an email and a password: no first and last name. Anyone may sign up;
 * the town gate refuses an outsider through the Traveler, who has no citizen claim.
 */
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
      validations: {
        email: {},
        length: { max: 255 },
      },
      required: { roles: ['user'] },
      permissions: { view: ['admin', 'user'], edit: ['admin', 'user'] },
      multivalued: false,
    },
    {
      // The deed to a player's house: the id of their house. Only the game server may set it.
      name: 'deed',
      displayName: 'Deed',
      permissions: { view: ['admin'], edit: ['admin'] },
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
    // Any address may sign up, unverified: being a citizen comes from the citizen group, which the Oracle
    // grants in the game, not from an address. Never reuse this realm for anything real.
    registrationAllowed: true,
    registrationEmailAsUsername: true,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    verifyEmail: false,
    resetPasswordAllowed: false,
    rememberMe: false,
    sslRequired: 'external',
    groups: [{ name: 'citizen' }, { name: 'knights' }, { name: 'scholars' }],
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
          deedMapper,
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

/**
 * Players' houses: a namespace for their Ingresses, a way back to the game from there, and the game's
 * permission to manage those Ingresses and nothing else.
 */
function houses(): Yaml[] {
  const ingresses = { apiGroups: ['networking.k8s.io'], resources: ['ingresses'] }

  return [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: HOUSES_NAMESPACE } },
    // An Ingress can only point at a Service in its own namespace, so this one forwards to the game.
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'quest', namespace: HOUSES_NAMESPACE },
      spec: {
        type: 'ExternalName',
        externalName: `quest.${NAMESPACE}.svc.cluster.local`,
        ports: [{ name: 'http', port: 3000 }],
      },
    },
    { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'quest', namespace: NAMESPACE } },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: 'quest-builder', namespace: HOUSES_NAMESPACE },
      rules: [
        { ...ingresses, verbs: ['get', 'list', 'create', 'update', 'patch', 'delete'] },
        // To see when the Ingress Controller has applied a house (it records an event on each one).
        { apiGroups: [''], resources: ['events'], verbs: ['list'] },
      ],
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: 'quest-builder', namespace: HOUSES_NAMESPACE },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'quest-builder' },
      subjects: [{ kind: 'ServiceAccount', name: 'quest', namespace: NAMESPACE }],
    },
  ]
}

/** Pomerium's pods, in the controller's namespace. */
const fromPomerium: Yaml = {
  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': POMERIUM_NAMESPACE } },
  podSelector: { matchLabels: { 'app.kubernetes.io/name': 'pomerium' } },
}

function manifests(secrets: Secrets): Yaml[] {
  const escapedDomain = DOMAIN.replace(/\./g, '\\.')

  return [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: NAMESPACE } },
    // Pomerium's own secrets, saved in .quest/ so sessions survive a redeploy. The controller wants
    // the raw bytes, and the saved values are already base64, so they go in `data` as they are.
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'bootstrap', namespace: POMERIUM_NAMESPACE },
      data: {
        shared_secret: secrets.sharedSecret,
        cookie_secret: secrets.cookieSecret,
        signing_key: secrets.signingKey,
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'idp', namespace: POMERIUM_NAMESPACE },
      stringData: { client_id: 'pomerium', client_secret: secrets.clientSecret },
    },
    pomeriumSettings(),
    ...routes(),
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'quest-secrets', namespace: NAMESPACE },
      stringData: {
        'quest-client-secret': secrets.questClientSecret,
        'keycloak-admin-password': secrets.keycloakAdminPassword,
        'visitor-password': secrets.visitorPassword,
      },
    },
    deployment(
      'quest',
      DEV ? APP_DEV_IMAGE : APP_IMAGE,
      3000,
      {
        env: [
          { name: 'QUEST_PUBLIC_ORIGIN', value: publicUrl('game') },
          { name: 'KEYCLOAK_URL', value: svc('keycloak', 8080) },
          { name: 'KEYCLOAK_REALM', value: REALM },
          { name: 'KEYCLOAK_CLIENT_ID', value: 'quest-admin' },
          secretEnv('KEYCLOAK_CLIENT_SECRET', 'quest-client-secret'),
          { name: 'NODE_EXTRA_CA_CERTS', value: '/certs/ca.crt' },
          { name: 'QUEST_HOUSES_NAMESPACE', value: HOUSES_NAMESPACE },
          { name: 'QUEST_HOUSE_LIMIT', value: String(HOUSE_LIMIT) },
          secretEnv('QUEST_VISITOR_PASSWORD', 'visitor-password'),
          ...(DEV ? [{ name: 'QUEST_HMR_PORT', value: String(PORT) }] : []),
        ],
        volumeMounts: [
          { name: 'certs', mountPath: '/certs', readOnly: true },
          ...(DEV ? DEV_SOURCES.map((dir) => ({ name: devVolume(dir), mountPath: `/repo/app/${dir}` })) : []),
        ],
        readinessProbe: { httpGet: { path: '/', port: 3000 }, periodSeconds: 3 },
      },
      {
        serviceAccountName: 'quest',
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
    ...houses(),
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
        ingress: [{ from: [fromPomerium] }],
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
            from: [fromPomerium, { podSelector: { matchLabels: labels('quest') } }],
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
        'quest.override': `rewrite name regex (.*)\\.${escapedDomain} pomerium-proxy.${POMERIUM_NAMESPACE}.svc.cluster.local answer auto\n`,
      },
    },
  ]
}

const secrets = loadSecrets()

mkdirSync(OUT, { recursive: true })

/**
 * The townsfolk who visit players' houses, as a Keycloak partial import. ./quest imports it at every
 * deploy, overwriting them, so their passwords and groups always match.
 */
const townsfolk = (secrets: Secrets) => ({
  ifResourceExists: 'OVERWRITE',
  users: VISITOR_IDS.map((id) => ({
    username: VISITORS[id].email,
    email: VISITORS[id].email,
    enabled: true,
    emailVerified: true,
    credentials: [
      { type: 'password', value: visitorPassword(secrets.visitorPassword, id), temporary: false },
    ],
    groups: VISITORS[id].groups.map((group) => `/${group}`),
  })),
})

const documents = (docs: readonly Yaml[]) => `${docs.map((doc) => toYaml(doc)).join('\n---\n')}\n`

// The controller goes first: its custom resource definition must exist before the Pomerium resource.
writeFileSync(join(OUT, 'pomerium.yaml'), documents(controller()))

writeFileSync(join(OUT, 'manifests.yaml'), documents(manifests(secrets)))

writeFileSync(join(OUT, 'townsfolk.json'), JSON.stringify(townsfolk(secrets)), { mode: 0o600 })

// What an older realm lacks to carry the deed; ./quest applies them, since Keycloak imports the realm only once.
writeFileSync(join(OUT, 'deed-profile.json'), JSON.stringify(userProfile))

writeFileSync(join(OUT, 'deed-mapper.json'), JSON.stringify(deedMapper))

console.log(`rendered ${OUT}/manifests.yaml for ${publicUrl('game')}`)
