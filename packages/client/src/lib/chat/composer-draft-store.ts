import { useEffect, useMemo } from 'react'

import { createLocalStorageStore } from '../local-storage-store'
import { debounce } from '../utils'

const STORAGE_KEY = 'chat-composer-drafts'

/** How many sessions retain an unsent draft before the oldest is evicted. */
const MAX_ENTRIES = 100

/** Draft key for the composer outside of any session. */
export const NO_SESSION_DRAFT_KEY = '@new-chat'

/** Autosave debounce for the composer/note editors. */
const SAVE_DEBOUNCE_MS = 300

type Draft = { text: string; updatedAt: number }

type Drafts = Record<string, Draft>

const store = createLocalStorageStore<Drafts>(STORAGE_KEY)

export function getDraft(key: string): string {
  return store.get()[key]?.text ?? ''
}

export function setDraft(key: string, text: string): void {
  if (!text.trim()) {
    clearDraft(key)
    return
  }

  const entry: Draft = { text, updatedAt: Date.now() }
  const next: Drafts = { ...store.get(), [key]: entry }

  const patch: Partial<Drafts> = { [key]: entry }
  for (const stale of evictableKeys(next)) patch[stale] = undefined
  store.set(patch)
}

export function clearDraft(key: string): void {
  store.set({ [key]: undefined } as Partial<Drafts>)
}

function evictableKeys(drafts: Drafts): string[] {
  // The session-less draft is never evicted as it has no session to go back to
  const keys = Object.keys(drafts).filter((key) => key !== NO_SESSION_DRAFT_KEY)
  if (keys.length <= MAX_ENTRIES) return []
  return keys
    .sort((a, b) => drafts[a].updatedAt - drafts[b].updatedAt)
    .slice(0, keys.length - MAX_ENTRIES)
}

export type ComposerDraft = {
  /** Current persisted draft text for the session. */
  read: () => string
  /** Debounced autosave. */
  save: (text: string) => void
  /** Persist immediately, cancelling any pending autosave. */
  flush: (text: string) => void
  /** Drop the draft and cancel any pending autosave. */
  clear: () => void
}

/**
 * Key-scoped draft accessors, shared by the composer and the approval note
 * editor. The key is a session id, or `NO_SESSION_DRAFT_KEY` outside of one.
 */
export function useComposerDraft(key: string | undefined): ComposerDraft {
  const debouncedSave = useMemo(
    () =>
      debounce(
        (id: string, text: string) => setDraft(id, text),
        SAVE_DEBOUNCE_MS,
      ),
    [],
  )

  useEffect(() => () => debouncedSave.cancel(), [debouncedSave])

  return useMemo(
    () => ({
      read: () => (key ? getDraft(key) : ''),
      save: (text) => {
        if (key) debouncedSave(key, text)
      },
      flush: (text) => {
        debouncedSave.cancel()
        if (key) setDraft(key, text)
      },
      clear: () => {
        debouncedSave.cancel()
        if (key) clearDraft(key)
      },
    }),
    [key, debouncedSave],
  )
}
