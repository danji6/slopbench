import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 3000,
  },
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@sb/client': path.resolve(__dirname, './src'),
      '@sb/convex': path.resolve(__dirname, '../convex/src'),
      '@sb/core': path.resolve(__dirname, '../core/src'),
      '@sb/sidecar': path.resolve(__dirname, '../sidecar/src'),
      '~': path.resolve(__dirname, '../..'),
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
