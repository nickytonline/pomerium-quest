import viteReact from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  server: { port: 3000 },
  plugins: [tanstackStart({ spa: { enabled: true } }), nitro(), viteReact()],
})
