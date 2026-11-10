import { Effect, Option, Schema } from 'effect'
import { MCP_PATH, aviaryOrigin } from '../game/owl.ts'
import type { OwlCall, OwlFlight, OwlOutcome } from '../game/perch.ts'
import { QuestConfig } from './config.ts'

// Where the owl is sent from. The perch's route is the game's MCP client route, so Pomerium adds an
// Authorization header carrying a token for the signed-in player. The server sends the owl's request to
// the Aviary, an MCP server route, with that token, and Pomerium checks it there against the Aviary's
// policy, on the player's behalf. The game never decides what the owl may do.

const Rpc = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({
      tools: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            title: Schema.optional(Schema.String),
            description: Schema.optional(Schema.String),
          }),
        ),
      ),
      content: Schema.optional(
        Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
      ),
      isError: Schema.optional(Schema.Boolean),
    }),
  ),
  error: Schema.optional(
    Schema.Struct({
      message: Schema.String,
      data: Schema.optional(Schema.Struct({ request_id: Schema.optional(Schema.String) })),
    }),
  ),
})

/** The JSON-RPC message in an MCP response, which arrives as plain JSON or as one server-sent event. */
const messageIn = (body: string, contentType: string) => {
  if (!contentType.includes('text/event-stream')) return body

  const data = body.split('\n').findLast((line) => line.startsWith('data:'))

  return data ? data.slice('data:'.length).trim() : ''
}

const params = (call: OwlCall) =>
  call.method === 'tools/call' ? { params: { name: call.tool, arguments: {} } } : {}

function read(status: number, message: string): OwlOutcome {
  if (status === 401) return { kind: 'signin' }

  const parsed = Option.getOrNull(Schema.decodeUnknownOption(Schema.fromJsonString(Rpc))(message))

  if (!parsed) return { kind: 'error', message: `the Aviary answered ${status}` }

  const { result, error } = parsed

  // Pomerium refuses an MCP request with a JSON-RPC error that names its request ID.
  if (error) return { kind: 'refused', message: error.message, requestId: error.data?.request_id ?? null }

  if (result?.tools) {
    return {
      kind: 'tools',
      tools: result.tools.map((tool) => ({
        name: tool.name,
        title: tool.title ?? null,
        description: tool.description ?? null,
      })),
    }
  }

  const text = (result?.content ?? []).flatMap((part) => (part.text ? [part.text] : [])).join('\n')

  return { kind: 'result', text, failed: result?.isError ?? false }
}

/** Indents a JSON message for reading; anything else is shown as it came. */
const pretty = (message: string) => {
  try {
    return JSON.stringify(JSON.parse(message), null, 2)
  } catch {
    return message
  }
}

/** Sends one MCP request to the Aviary with the token Pomerium put on `request` for its player. */
export const fly = (request: Request, call: OwlCall) =>
  Effect.gen(function* () {
    const config = yield* QuestConfig
    const url = `${aviaryOrigin(config.publicOrigin)}${MCP_PATH}`
    const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: call.method, ...params(call) }, null, 2)
    const authorization = request.headers.get('authorization')

    const lost = (message: string): OwlFlight => ({
      url,
      request: rpc,
      status: null,
      response: null,
      outcome: { kind: 'error', message },
    })

    // Only an MCP client route gets a token, so without one the request didn't come through the perch's route.
    if (!authorization) return lost('Pomerium gave the perch no token to fly with')

    return yield* Effect.tryPromise(async (): Promise<OwlFlight> => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: rpc,
      })

      const message = messageIn(await response.text(), response.headers.get('content-type') ?? '')

      return {
        url,
        request: rpc,
        status: response.status,
        response: message ? pretty(message) : null,
        outcome: read(response.status, message),
      }
    }).pipe(Effect.catch((error) => Effect.succeed(lost(String(error)))))
  })
