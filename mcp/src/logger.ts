import pino from 'pino'
import { getConfig } from './config.ts'

const config = getConfig()

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: config.SERVER_NAME, version: config.SERVER_VERSION },
  formatters: { level: (label) => ({ level: label }) },
})
