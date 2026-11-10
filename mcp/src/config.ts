import { z } from 'zod'

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SERVER_NAME: z.string().default('pomerium-quest-aviary'),
  SERVER_VERSION: z.string().default('0.1.0'),
  /** The public origins of the two routes Pomerium serves this server at, e.g. https://aviary.localhost.pomerium.io */
  QUEST_AVIARY_ORIGIN: z.url().default('https://aviary.localhost.pomerium.io'),
  QUEST_ROOKERY_ORIGIN: z.url().default('https://rookery.localhost.pomerium.io'),
  /** In-cluster address of Keycloak (the Oracle), for its admin API. */
  KEYCLOAK_URL: z.url().default('http://localhost:8080'),
  KEYCLOAK_REALM: z.string().default('kingdom'),
  /** The game's Keycloak client, whose service account may add players to groups. */
  KEYCLOAK_CLIENT_ID: z.string().default('quest-admin'),
  KEYCLOAK_CLIENT_SECRET: z.string().default('dev-only-client-secret'),
})

export type Config = z.infer<typeof configSchema>

let config: Config | undefined

/** The server's settings, read from the environment once. */
export function getConfig(): Config {
  config ??= configSchema.parse(process.env)

  return config
}
