import { useEffect, useMemo } from 'react'

import { createLocalStorageStore } from '../local-storage-store'
import { debounce } from '../utils'
import {
  isDraftPending,
  keepDraftRestore,
  releaseDraftRestore,
  requestDraftRestore,
} from './draft-restore'

const STORAGE_KEY = 'chat-editor-drafts'

/** How many editors retain an unsaved draft before the oldest is evicted. */
const MAX_ENTRIES = 50

/** Autosave debounce for the prompt, reminder and script editors. */
const SAVE_DEBOUNCE_MS = 300

type Entry = { value: unknown; updatedAt: number }

type Drafts = Record<string, Entry>

const store = createLocalStorageStore<Drafts>(STORAGE_KEY)

/** Draft key for a prompt editor. */
export function promptDraftKey(promptId: string): string {
  return `prompt:${promptId}`
}

/** Draft key for a reminder editor. */
export function reminderDraftKey(reminderId: string): string {
  return `reminder:${reminderId}`
}

/** Draft key for a session's plan editor. */
export function planDraftKey(sessionId: string): string {
  return `plan:${sessionId}`
}

/** Draft key for the script manager, which edits one list at a time. */
export const SCRIPTS_DRAFT_KEY = 'scripts'

/** Draft key for one agent's settings form. */
export function agentSettingsDraftKey(agentId: string): string {
  return `agent-settings:${agentId}`
}

/** Draft key for the user settings form, of which there is only one. */
export const USER_SETTINGS_DRAFT_KEY = 'user-settings'

export function getEditorDraft<T>(key: string): T | undefined {
  return store.get()[key]?.value as T | undefined
}

export function setEditorDraft<T>(key: string, value: T): void {
  const entry: Entry = { value, updatedAt: Date.now() }
  const next: Drafts = { ...store.get(), [key]: entry }

  const patch: Partial<Drafts> = { [key]: entry }
  for (const stale of evictableKeys(next)) patch[stale] = undefined
  store.set(patch)
}

export function clearEditorDraft(key: string): void {
  if (!(key in store.get())) return
  store.set({ [key]: undefined } as Partial<Drafts>)
}

function evictableKeys(drafts: Drafts): string[] {
  const keys = Object.keys(drafts)
  if (keys.length <= MAX_ENTRIES) return []
  return keys
    .sort((a, b) => drafts[a].updatedAt - drafts[b].updatedAt)
    .slice(0, keys.length - MAX_ENTRIES)
}

export type EditorDraft<T> = {
  /** Current persisted draft, or undefined when there is none. */
  read: () => T | undefined
  /** Debounced autosave. */
  save: (value: T) => void
  /** Persist immediately, cancelling any pending autosave. */
  flush: (value: T) => void
  /** Drop the draft and cancel any pending autosave. */
  clear: () => void
  /**
   * Drop the draft because the editor has come back to what is stored.
   * Ignored while the draft confirmation is still pending.
   */
  clearUnchanged: () => void
  /** Asks the user before handing a stored draft to `apply`. */
  restore: (apply: (value: T) => void) => void
}

export function useEditorDraft<T>(
  key: string | undefined,
  /** Names the draft in the confirmation: "unsaved changes to <label>". */
  label: string,
): EditorDraft<T> {
  const debouncedSave = useMemo(
    () =>
      debounce(
        (id: string, value: unknown) => setEditorDraft(id, value),
        SAVE_DEBOUNCE_MS,
      ),
    [],
  )

  useEffect(() => {
    if (key) keepDraftRestore(key)
    return () => {
      debouncedSave.cancel()
      if (key) releaseDraftRestore(key)
    }
  }, [key, debouncedSave])

  return useMemo(
    () => ({
      read: () => (key ? getEditorDraft<T>(key) : undefined),
      save: (value) => {
        if (key) debouncedSave(key, value)
      },
      flush: (value) => {
        debouncedSave.cancel()
        if (key) setEditorDraft(key, value)
      },
      clear: () => {
        debouncedSave.cancel()
        if (key) clearEditorDraft(key)
      },
      clearUnchanged: () => {
        if (!key || isDraftPending(key)) return
        debouncedSave.cancel()
        clearEditorDraft(key)
      },
      restore: (apply) => {
        const saved = key ? getEditorDraft<T>(key) : undefined
        if (!key || saved === undefined) return
        requestDraftRestore({
          key,
          label,
          apply: () => apply(saved),
          discard: () => {
            debouncedSave.cancel()
            clearEditorDraft(key)
          },
        })
      },
    }),
    [key, label, debouncedSave],
  )
}
