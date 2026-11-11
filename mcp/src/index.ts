// The Aviary: the MCP server chapter two's owl talks to, built from
// https://github.com/nickytonline/mcp-typescript-template. Pomerium serves it at one route, whose
// policy decides which owls get in and which tools they may call; nothing else can reach it.
import { toNodeHandler } from '@modelcontextprotocol/node'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import express from 'express'
import { MCP_PATH } from '../../app/src/game/owl.ts'
import { getConfig } from './config.ts'
import { pomeriumVerifier } from './identity.ts'
import { logger } from './logger.ts'
import { keycloakGrant } from './oracle.ts'
import { registerTools } from './tools.ts'

const config = getConfig()
const verify = pomeriumVerifier(config)
const grant = keycloakGrant(config)

// The factory runs fresh for every request, so each one gets tools bound to whoever Pomerium says sent it.
const handler = createMcpHandler(
  async ({ requestInfo }) => {
    const server = new McpServer({ name: config.SERVER_NAME, version: config.SERVER_VERSION })
    registerTools(server, await verify(requestInfo?.headers ?? new Headers()), grant)

    return server
  },
  { onerror: (error) => logger.error({ error: error.message }, 'error handling MCP request') },
)

const nodeHandler = toNodeHandler(handler, {
  onerror: (error) => logger.error({ error: error.message }, 'error adapting MCP request for Node'),
})

const app = express()

app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.all(MCP_PATH, (req, res) => {
  nodeHandler(req, res, req.body).catch((error: Error) => {
    logger.error({ error: error.message }, 'unhandled error serving MCP request')

    if (res.headersSent) {
      res.end()

      return
    }

    res
      .status(500)
      .json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
  })
})

const shutDown = () => {
  logger.info('shutting down')
  void handler.close().finally(() => process.exit(0))
}

process.on('SIGTERM', shutDown)

process.on('SIGINT', shutDown)

app.listen(config.PORT, () => {
  logger.info(`${config.SERVER_NAME} listening on port ${config.PORT}`)
})
