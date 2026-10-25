import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { defineConfig, type Plugin } from 'vite-plus'

/**
 * The game modules hold one shared store and a running Phaser scene, which can't be swapped in
 * place: hot-updating them leaves React and Phaser on two different copies of the state. Reload
 * the page instead; progress is saved on every step, and in dev the game resumes past the title.
 */
const reloadOnGameChange = (): Plugin => ({
  name: 'quest:reload-on-game-change',
  apply: 'serve',
  hotUpdate({ file }) {
    if (this.environment.name !== 'client' || !file.includes('/src/game/')) return
    this.environment.hot.send({ type: 'full-reload' })

    return []
  },
})

const hmrPort = process.env['QUEST_HMR_PORT'] ? Number(process.env['QUEST_HMR_PORT']) : undefined

export default defineConfig({
  server: {
    port: 3000,
    // Under `./quest dev` the dev server runs in the cluster: Pomerium forwards the in-cluster host,
    // and the browser reaches the HMR socket through Pomerium's public port.
    allowedHosts: ['.svc.cluster.local'],
    hmr: hmrPort ? { clientPort: hmrPort } : true,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    nitro(),
    viteReact(),
    reloadOnGameChange(),
  ],
})
