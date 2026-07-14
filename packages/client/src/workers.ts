import { type Remote, wrap } from 'comlink'

import type { SchemeExport } from './lib/theme'

export type WorkerApi<T> = {
  api: Remote<T>
  terminate: () => void
}

export type ThemeWorkerApi = {
  sourceColorFromBytes: (bytes: Uint8ClampedArray) => Promise<string>
  sourceColorFromBitmap: (bitmap: ImageBitmap) => Promise<string>
  exportSchemeCss: (
    sourceColor: string,
    isDark: boolean,
    contrast: number,
  ) => Promise<SchemeExport>
}

export function ThemeWorker() {
  const worker = new Worker(
    new URL('./workers/theme.worker.ts', import.meta.url),
    { type: 'module' },
  )

  return expose<ThemeWorkerApi>(worker)
}

export type ShikiWorkerApi = {
  highlight: (code: string, lang?: string) => Promise<string>
  highlightDiff: (diff: string, lang?: string) => Promise<string>
}

export function ShikiWorker() {
  const worker = new Worker(
    new URL('./workers/shiki.worker.ts', import.meta.url),
    { type: 'module' },
  )

  return expose<ShikiWorkerApi>(worker)
}

function expose<T>(worker: Worker): WorkerApi<T> {
  return {
    api: wrap<T>(worker),
    terminate: () => worker.terminate(),
  }
}
