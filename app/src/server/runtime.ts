import { Effect, Layer, ManagedRuntime } from 'effect'
import { QuestConfigLive } from './config.ts'
import { PomeriumIdentityLive } from './identity.ts'
import { OracleAdminLive } from './oracle-admin.ts'

const AppLayer = Layer.mergeAll(PomeriumIdentityLive, OracleAdminLive).pipe(
  Layer.provideMerge(QuestConfigLive),
)

export const runtime = ManagedRuntime.make(AppLayer)

export type AppServices = ManagedRuntime.ManagedRuntime.Services<typeof runtime>

export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

export const json = (status: number, body: Json) => Response.json(body, { status })

/** Runs a handler; any failure that escaped the handler becomes a 500 with its message. */
export const respond = <E>(effect: Effect.Effect<Response, E, AppServices>) =>
  runtime.runPromise(
    effect.pipe(
      Effect.catchCause((cause) => Effect.succeed(json(500, { error: 'internal', detail: String(cause) }))),
    ),
  )
