import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

// `__dirname` is unavailable under Vite's native config loader
const root = import.meta.dirname

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
  plugins: [tailwindcss(), react()],
  preview: { allowedHosts: allowedHosts() },
  server: { allowedHosts: allowedHosts() },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      '@sb/client': path.resolve(root, './src'),
      '@sb/convex': path.resolve(root, '../convex/src'),
      '@sb/core': path.resolve(root, '../core/src'),
      '@sb/sidecar': path.resolve(root, '../sidecar/src'),
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
