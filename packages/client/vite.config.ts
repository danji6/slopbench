import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFile } from 'node:fs/promises'
import path from 'path'
import { glob } from 'tinyglobby'
import { type Plugin, defineConfig } from 'vite'

// `__dirname` is unavailable under Vite's native config loader
const root = import.meta.dirname

function fontLicenses(): Plugin {
  return {
    name: 'font-licenses',
    apply: 'build',
    async generateBundle() {
      const cwd = path.resolve(root, 'src/assets/fonts')
      const licenses = await glob('**/LICENSE.txt', { cwd })

      for (const license of licenses) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/fonts/${license}`,
          source: await readFile(path.join(cwd, license)),
        })
      }
    },
  }
}

function allowedHosts(): string[] {
  const values = [
    process.env.FRONTEND_URL,
    ...(process.env.ALLOWED_HOSTS ?? '').split(','),
  ]

  const hosts = values.flatMap((value) => {
    const trimmed = value?.trim()
    if (!trimmed) return []

    try {
      return [new URL(trimmed).hostname]
    } catch {
      return [trimmed]
    }
  })

  return [...new Set(hosts)]
}

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 3000,
  },
  // Prevents cold starts / page reloads when the first xterm is mounted
  optimizeDeps: { include: ['@xterm/xterm', '@xterm/addon-fit'] },
  plugins: [tailwindcss(), react(), fontLicenses()],
  preview: { allowedHosts: allowedHosts() },
  server: { allowedHosts: allowedHosts() },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      '@cv/client': path.resolve(root, './src'),
      '@cv/convex': path.resolve(root, '../convex/src'),
      '@cv/core': path.resolve(root, '../core/src'),
      '@cv/sidecar': path.resolve(root, '../sidecar/src'),
      '~': path.resolve(root, '../..'),
    },
    dedupe: [
      'prosemirror-changeset',
      'prosemirror-commands',
      'prosemirror-dropcursor',
      'prosemirror-gapcursor',
      'prosemirror-history',
      'prosemirror-keymap',
      'prosemirror-model',
      'prosemirror-schema-list',
      'prosemirror-state',
      'prosemirror-tables',
      'prosemirror-transform',
      'prosemirror-view',
    ],
  },
})
