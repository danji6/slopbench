import { APP_ID } from '@sb/core/const'
import { useEffect, useMemo } from 'react'

import { debounce } from '../utils'
import { createTextDraftStore } from './text-draft-store'

/** Draft key for the composer outside of any session. */
export const NO_SESSION_DRAFT_KEY = '@new-chat'

const SAVE_DEBOUNCE_MS = 300
const store = createTextDraftStore(`${APP_ID}-composer-drafts`, NO_SESSION_DRAFT_KEY) // prettier-ignore

type ComposerDraft = {
  /** Current persisted draft text for the session. */
  read: () => string
  /** Debounced autosave. */
  save: (text: string) => void
  /** Drop the draft and cancel any pending autosave. */
  clear: () => void
}

/** Provides draft accessors for a session or the new-chat composer. */
export function useComposerDraft(key: string | undefined): ComposerDraft {
  const debouncedSave = useMemo(
    () => debounce(store.write, SAVE_DEBOUNCE_MS),
    [],
  )

  useEffect(() => () => debouncedSave.cancel(), [debouncedSave])

  return useMemo(
    () => ({
      read: () => (key ? store.read(key) : ''),
      save: (text) => {
        if (key) debouncedSave(key, text)
      },
      clear: () => {
        debouncedSave.cancel()
        if (key) store.clear(key)
      },
    }),
    [key, debouncedSave],
  )
}
