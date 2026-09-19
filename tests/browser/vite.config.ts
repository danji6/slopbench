import { defineConfig, mergeConfig } from 'vite'

import client from '../../packages/client/vite.config.ts'

export default mergeConfig(
  client,
  defineConfig({
    root: import.meta.dirname,
    build: { outDir: 'dist' },
  }),
)
