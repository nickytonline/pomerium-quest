// Renders the Pomerium config and the Kubernetes manifests from app/src/game/zones.ts, so the
// policies Pomerium enforces are the same ones the game shows on its signs.
//
//   node scripts/render.ts            → deploy/.generated/*.yaml
//
// Environment: QUEST_DOMAIN (default localhost.pomerium.io), QUEST_PORT (default 443).
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ZONES, type AllowRule, type Criterion } from '../app/src/game/zones.ts'

type Yaml = string | number | boolean | readonly Yaml[] | { readonly [key: string]: Yaml }

const ROOT = new URL('..', import.meta.url).pathname
const OUT = join(ROOT, 'deploy/.generated')
const STATE = join(ROOT, '.quest')
const NAMESPACE = 'quest'
const POMERIUM_IMAGE = 'pomerium/pomerium:v0.33.4'
const APP_IMAGE = 'pomerium-quest/app:dev'
const ORACLE_IMAGE = 'pomerium-quest/oracle:dev'

const DOMAIN = process.env['QUEST_DOMAIN'] ?? 'localhost.pomerium.io'
const PORT = Number(process.env['QUEST_PORT'] ?? '443')
const hostPort = PORT === 443 ? '' : `:${PORT}`
const publicUrl = (subdomain: string) => `https://${subdomain}.${DOMAIN}${hostPort}`
const svc = (name: string, port: number) => `http://${name}.${NAMESPACE}.svc.cluster.local:${port}`

interface Secrets {
  readonly sharedSecret: string
  readonly cookieSecret: string
  readonly signingKey: string
  readonly clientSecret: string
  readonly oracleAdminKey: string
  readonly oracleCookieKey: string
}

/** Secrets are generated once and kept in .quest/ so sessions survive a re-render. */
function loadSecrets(): Secrets {
  const file = join(STATE, 'secrets.json')

  if (existsSync(file)) {
    // SAFETY: written by this function below and never edited by hand.
    return JSON.parse(readFileSync(file, 'utf8')) as Secrets
  }

  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const secrets: Secrets = {
    sharedSecret: randomBytes(32).toString('base64'),
    cookieSecret: randomBytes(32).toString('base64'),
    signingKey: Buffer.from(pem).toString('base64'),
    clientSecret: randomBytes(24).toString('hex'),
    oracleAdminKey: randomBytes(24).toString('hex'),
    oracleCookieKey: randomBytes(24).toString('hex'),
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

const SIMPLE_KEY = /^[A-Za-z_][\w./-]*$/

function scalar(value: string | number | boolean) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

function toYaml(value: Yaml, indent = 0): string {
  const pad = ' '.repeat(indent)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'

    return value
      .map((item: Yaml) => {
        const body = toYaml(item, indent + 2)

        return `${pad}- ${body.trimStart()}`
      })
      .join('\n')
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)

    if (entries.length === 0) return '{}'

    return entries
      .map(([key, item]) => {
        const name = SIMPLE_KEY.test(key) ? key : JSON.stringify(key)
        const nested = Array.isArray(item) ? item.length > 0 : item !== null && typeof item === 'object'

        return nested ? `${pad}${name}:\n${toYaml(item, indent + 2)}` : `${pad}${name}: ${toYaml(item)}`
      })
      .join('\n')
  }

  return scalar(value)
}

function pomeriumConfig(secrets: Secrets): Yaml {
  const app = svc('quest', 3000)
  const game = publicUrl('game')

  return {
    address: ':8443',
    authenticate_service_url: publicUrl('authenticate'),
    idp_provider: 'oidc',
    idp_provider_url: publicUrl('oracle'),
    idp_client_id: 'pomerium',
    idp_client_secret: secrets.clientSecret,
    idp_scopes: ['openid', 'email', 'profile', 'groups'],
    shared_secret: secrets.sharedSecret,
    cookie_secret: secrets.cookieSecret,
    signing_key: secrets.signingKey,
    certificate_file: '/certs/tls.crt',
    certificate_key_file: '/certs/tls.key',
    // Forward the identity provider's groups claim to the app as a header too.
    jwt_claims_headers: { 'X-Pomerium-Claim-Groups': 'groups' },
    routes: [
      {
        from: publicUrl('oracle'),
        to: svc('oracle', 4000),
        allow_public_unauthenticated_access: true,
        preserve_host_header: true,
      },
      // One route per zone: same host, its own path prefix, its own policy.
      ...ZONES.map((zone) => ({
        from: game,
        prefix: zone.prefix,
        to: app,
        pass_identity_headers: true,
        policy: policy(zone.policy),
      })),
      // Everything else (the game shell and its assets) is public.
      { from: game, to: app, allow_public_unauthenticated_access: true, pass_identity_headers: true },
    ],
  }
}

const labels = (name: string) => ({ app: name })

function deployment(name: string, image: string, port: number, extra: { [key: string]: Yaml }): Yaml {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace: NAMESPACE, labels: labels(name) },
    spec: {
      replicas: 1,
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
          ...(name === 'pomerium'
            ? {
                volumes: [
                  { name: 'config', secret: { secretName: 'pomerium-config' } },
                  { name: 'certs', secret: { secretName: 'quest-tls' } },
                ],
              }
            : {
                volumes: [
                  {
                    name: 'certs',
                    secret: { secretName: 'quest-tls', items: [{ key: 'ca.crt', path: 'ca.crt' }] },
                  },
                ],
              }),
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

const secretEnv = (name: string, key: string) => ({
  name,
  valueFrom: { secretKeyRef: { name: 'quest-secrets', key } },
})

function manifests(secrets: Secrets): Yaml[] {
  const escapedDomain = DOMAIN.replace(/\./g, '\\.')

  return [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: NAMESPACE } },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'quest-secrets', namespace: NAMESPACE },
      stringData: {
        'client-secret': secrets.clientSecret,
        'oracle-admin-key': secrets.oracleAdminKey,
        'oracle-cookie-key': secrets.oracleCookieKey,
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'pomerium-config', namespace: NAMESPACE },
      stringData: { 'config.yaml': `${toYaml(pomeriumConfig(secrets))}\n` },
    },
    deployment('pomerium', POMERIUM_IMAGE, 8443, {
      args: ['-config', '/pomerium/config.yaml'],
      env: [{ name: 'SSL_CERT_DIR', value: '/etc/ssl/certs:/certs' }],
      volumeMounts: [
        { name: 'config', mountPath: '/pomerium', readOnly: true },
        { name: 'certs', mountPath: '/certs', readOnly: true },
      ],
    }),
    service('pomerium', PORT, 8443, 'LoadBalancer'),
    deployment('quest', APP_IMAGE, 3000, {
      env: [
        { name: 'QUEST_MODE', value: 'pomerium' },
        { name: 'QUEST_PUBLIC_ORIGIN', value: publicUrl('game') },
        { name: 'ORACLE_ADMIN_URL', value: svc('oracle', 4000) },
        secretEnv('ORACLE_ADMIN_KEY', 'oracle-admin-key'),
        { name: 'NODE_EXTRA_CA_CERTS', value: '/certs/ca.crt' },
      ],
      volumeMounts: [{ name: 'certs', mountPath: '/certs', readOnly: true }],
      readinessProbe: { httpGet: { path: '/', port: 3000 }, periodSeconds: 3 },
    }),
    service('quest', 3000, 3000),
    deployment('oracle', ORACLE_IMAGE, 4000, {
      env: [
        { name: 'ORACLE_ISSUER', value: publicUrl('oracle') },
        { name: 'ORACLE_REDIRECT_URI', value: `${publicUrl('authenticate')}/oauth2/callback` },
        secretEnv('ORACLE_CLIENT_SECRET', 'client-secret'),
        secretEnv('ORACLE_ADMIN_KEY', 'oracle-admin-key'),
        secretEnv('ORACLE_COOKIE_KEY', 'oracle-cookie-key'),
      ],
      volumeMounts: [{ name: 'certs', mountPath: '/certs', readOnly: true }],
      readinessProbe: { httpGet: { path: '/healthz', port: 4000 }, periodSeconds: 3 },
    }),
    service('oracle', 4000, 4000),
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
      metadata: { name: 'oracle-from-pomerium-and-quest', namespace: NAMESPACE },
      spec: {
        podSelector: { matchLabels: labels('oracle') },
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
