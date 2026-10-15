/** Reads the saved folder expansion state. */
export function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem('session-folder-collapse') ?? '{}')
  } catch {
    return {}
  }
}

/** Persists folder expansion state when browser storage is available. */
export function saveCollapsed(value: Record<string, boolean>) {
  try {
    localStorage.setItem('session-folder-collapse', JSON.stringify(value))
  } catch {
    /* Storage may be unavailable. */
  }
}
