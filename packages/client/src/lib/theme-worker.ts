import { ThemeWorker, type ThemeWorkerApi, type WorkerApi } from '@/workers'

import { type SchemeExport, type ThemeSnapshot, exportSchemeCss } from './theme'

// Using a singleton to avoid cold starts
let worker: WorkerApi<ThemeWorkerApi> | null | undefined

function getWorker(): WorkerApi<ThemeWorkerApi> | null {
  if (worker !== undefined) return worker
  try {
    worker = typeof Worker === 'undefined' ? null : ThemeWorker()
  } catch {
    worker = null
  }
  return worker
}

export async function generateThemeCss(
  sourceColor: string,
  isDark: boolean,
  contrast = 0,
): Promise<SchemeExport> {
  const instance = getWorker()

  // Synchronous fallback
  if (!instance) return exportSchemeCss(sourceColor, isDark, contrast)

  try {
    return await instance.api.exportSchemeCss(sourceColor, isDark, contrast)
  } catch {
    worker = null // Disable the worker since it caused a failure
    return exportSchemeCss(sourceColor, isDark, contrast)
  }
}

export async function snapshotTheme(source: string): Promise<ThemeSnapshot> {
  const [light, dark] = await Promise.all([
    generateThemeCss(source, false),
    generateThemeCss(source, true),
  ])
  return { source, light: light.css, dark: dark.css }
}
