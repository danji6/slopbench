type LocalStorageObject = Record<string, unknown>

type LocalStorageStore<T extends LocalStorageObject> = {
  get: () => T
  subscribe: (listener: () => void) => () => boolean
  set: (patch: Partial<T>) => void
}

function read<T extends LocalStorageObject>(key: string): T {
  if (typeof localStorage === 'undefined') return {} as T
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : ({} as T)
  } catch {
    return {} as T
  }
}

export function createLocalStorageStore<T extends LocalStorageObject>(
  key: string,
): LocalStorageStore<T> {
  let cache = read<T>(key)
  const listeners = new Set<() => void>()

  function emit() {
    listeners.forEach((listener) => listener())
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== key) return
      cache = read<T>(key)
      emit()
    })
  }

  return {
    get: () => cache,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (patch) => {
      const next: T = { ...cache }
      const writable = next as Record<string, unknown>
      for (const [patchKey, value] of Object.entries(patch)) {
        if (value === undefined) delete writable[patchKey]
        else writable[patchKey] = value
      }
      cache = next
      try {
        localStorage.setItem(key, JSON.stringify(cache))
      } catch {
        // Ignore storage write failures
      }
      emit()
    },
  }
}
