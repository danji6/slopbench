import { useEffect, useMemo } from 'react'

import { createLocalStorageStore } from '../local-storage-store'
import { debounce } from '../utils'

const STORAGE_KEY = 'chat-composer-drafts'

/** How many sessions retain an unsent draft before the oldest is evicted. */
const MAX_ENTRIES = 100

/** Autosave debounce for the composer/note editors. */
const SAVE_DEBOUNCE_MS = 300

type Draft = { text: string; updatedAt: number }

type Drafts = Record<string, Draft>

const store = createLocalStorageStore<Drafts>(STORAGE_KEY)

export function getDraft(sessionId: string): string {
  return store.get()[sessionId]?.text ?? ''
}

export function setDraft(sessionId: string, text: string): void {
  if (!text.trim()) {
    clearDraft(sessionId)
    return
  }

  const entry: Draft = { text, updatedAt: Date.now() }
  const next: Drafts = { ...store.get(), [sessionId]: entry }

  const patch: Partial<Drafts> = { [sessionId]: entry }
  for (const key of evictableKeys(next)) patch[key] = undefined
  store.set(patch)
}

export function clearDraft(sessionId: string): void {
  store.set({ [sessionId]: undefined } as Partial<Drafts>)
}

function evictableKeys(drafts: Drafts): string[] {
  const keys = Object.keys(drafts)
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
 * Session-scoped draft accessors, shared by the composer and the approval note
 * editor.
 */
export function useComposerDraft(sessionId: string | undefined): ComposerDraft {
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
      read: () => (sessionId ? getDraft(sessionId) : ''),
      save: (text) => {
        if (sessionId) debouncedSave(sessionId, text)
      },
      flush: (text) => {
        debouncedSave.cancel()
        if (sessionId) setDraft(sessionId, text)
      },
      clear: () => {
        debouncedSave.cancel()
        if (sessionId) clearDraft(sessionId)
      },
    }),
    [sessionId, debouncedSave],
  )
}
