import { createFileRoute } from '@tanstack/react-router'
import { respond } from '../../server/runtime.ts'
import { handleZone } from '../../server/zones.ts'

export const Route = createFileRoute('/zones/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => respond(handleZone(request, params._splat ?? '')),
      POST: ({ request, params }) => respond(handleZone(request, params._splat ?? '')),
    },
  },
})
