import { APP_ID } from '@sb/core/const'

const STORAGE_KEY = `${APP_ID}-session-folder-collapse`

/** Reads the saved folder expansion state. */
export function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Persists folder expansion state when browser storage is available. */
export function saveCollapsed(value: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* Storage may be unavailable. */
  }
}
