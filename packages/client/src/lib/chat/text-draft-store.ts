import { createLocalStorageStore } from '../local-storage-store'

type Draft = { text: string; updatedAt: number }
type Drafts = Record<string, Draft | undefined>
const MAX_ENTRIES = 100

/** Retains the 100 most recent drafts, plus an optional protected draft. */
export function createTextDraftStore(
  storageKey: string,
  protectedKey?: string,
) {
  const store = createLocalStorageStore<Drafts>(storageKey)

  function clear(key: string) {
    store.set({ [key]: undefined })
  }

  function write(key: string, text: string) {
    if (!text.trim()) {
      clear(key)
      return
    }

    const entry = { text, updatedAt: Date.now() }
    const next = { ...store.get(), [key]: entry }
    const keys = Object.keys(next).filter((id) => id !== protectedKey)
    const patch: Drafts = { [key]: entry }
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => next[a]!.updatedAt - next[b]!.updatedAt)
      for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) {
        patch[stale] = undefined
      }
    }
    store.set(patch)
  }

  return { read: (key: string) => store.get()[key]?.text ?? '', write, clear }
}
