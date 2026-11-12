import { defineConfig } from 'vite-plus'

/**
 * Integration tests against a running `./quest` deployment. Each test file is one scenario with its own
 * players, so Vitest runs the files at once and the run takes as long as the slowest one (the waits for
 * Pomerium's claims cache) instead of the sum.
 */
export default defineConfig({
  test: {
    include: ['integration/**/*.integration.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
    fileParallelism: true,
  },
})
