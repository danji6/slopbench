import { defineConfig, mergeConfig } from 'vite'

import client from '../../packages/client/vite.config.ts'

export default mergeConfig(
  client,
  defineConfig({
    root: import.meta.dirname,
    publicDir: new URL('../../packages/client/public', import.meta.url)
      .pathname,
    build: { outDir: 'dist' },
  }),
)
