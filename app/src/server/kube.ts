import { Context, Effect, Layer } from 'effect'
import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import { KubeUnavailable } from './errors.ts'

// The game server's own access to the Kubernetes API, as its ServiceAccount. Its Role only lets it
// manage Ingresses in the houses namespace (see scripts/render.ts), so this is the third layer that
// keeps houses apart: even a bug here can't reach the gates or the Oracle.

const ACCOUNT = '/var/run/secrets/kubernetes.io/serviceaccount'

/** A Kubernetes object the game writes. */
export interface KubeObject {
  readonly apiVersion: string
  readonly kind: string
  readonly metadata: { readonly name: string; readonly namespace: string }
  readonly spec: object
}

export interface KubeResponse {
  readonly status: number
  readonly body: unknown
}

export class Kube extends Context.Service<
  Kube,
  {
    readonly call: (
      method: 'GET' | 'PATCH' | 'DELETE',
      path: string,
      body?: KubeObject,
    ) => Effect.Effect<KubeResponse, KubeUnavailable>
  }
>()('Kube') {}

const read = (file: string) => {
  try {
    return readFileSync(`${ACCOUNT}/${file}`, 'utf8')
  } catch {
    return null
  }
}

export const KubeLive = Layer.sync(Kube, () => {
  const host = process.env['KUBERNETES_SERVICE_HOST']
  const port = process.env['KUBERNETES_SERVICE_PORT'] ?? '443'
  const ca = read('ca.crt')

  const call = (method: 'GET' | 'PATCH' | 'DELETE', path: string, body?: KubeObject) =>
    Effect.tryPromise({
      try: () =>
        new Promise<KubeResponse>((resolve, reject) => {
          // The token rotates, so read it for every call.
          const token = read('token')

          if (!host || !token || !ca) {
            reject(new Error('not running in Kubernetes with a service account'))

            return
          }

          const payload = body === undefined ? undefined : JSON.stringify(body)

          const headers = new Map([
            ['authorization', `Bearer ${token.trim()}`],
            ['accept', 'application/json'],
          ])

          // Server-side apply: the house's Ingress becomes exactly what the game writes, and fields the
          // game no longer writes (like the public annotation after the first save) are removed.
          if (payload) headers.set('content-type', 'application/apply-patch+yaml')

          const req = request(
            { host, port, path, method, ca, headers: Object.fromEntries(headers) },
            (res) => {
              const chunks: Buffer[] = []
              res.on('data', (chunk: Buffer) => chunks.push(chunk))
              res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8')

                try {
                  resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null })
                } catch {
                  resolve({ status: res.statusCode ?? 0, body: text })
                }
              })
            },
          )

          req.on('error', reject)
          req.end(payload)
        }),
      catch: (cause) => new KubeUnavailable({ reason: String(cause) }),
    })

  return { call }
})
