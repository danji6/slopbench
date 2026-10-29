import { APP_ID } from '@sb/core/const'

const STORAGE_KEY = `${APP_ID}-session-folder-collapse`

/** Applies expansion choices in action order, including defaults for unloaded descendants. */
export function isFolderCollapsed(
  state: Record<string, boolean>,
  id: string,
  ancestorIds: string[] = [],
) {
  const keys = new Set([
    '*',
    id,
    ...ancestorIds.map((ancestor) => `branch:${ancestor}`),
  ])
  let collapsed = false
  for (const [key, value] of Object.entries(state)) {
    if (keys.has(key)) collapsed = value
  }
  return collapsed
}

/** Records a new choice after earlier inherited and individual choices. */
export function setFolderCollapsed(
  state: Record<string, boolean>,
  key: string,
  value: boolean,
) {
  const next = { ...state }
  delete next[key]
  next[key] = value
  return next
}

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
