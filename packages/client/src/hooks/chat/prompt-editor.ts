import { type ViewHandle, useView } from '@/hooks/view'

/**
 * `?view=` segments owned by the prompt editors, nested below whichever
 * settings dialog owns the list. Each segment value is an item id.
 */
export const PROMPT_EDITOR_VIEW = 'prompt'
export const LIBRARY_PROMPT_EDITOR_VIEW = 'library'
export const REMINDER_EDITOR_VIEW = 'reminder'

/** Ordered prompt lists: global, agent, compaction and impersonation. */
export function usePromptEditorView(): ViewHandle {
  return useView(PROMPT_EDITOR_VIEW)
}

export function useLibraryPromptEditorView(): ViewHandle {
  return useView(LIBRARY_PROMPT_EDITOR_VIEW)
}

export function useReminderEditorView(): ViewHandle {
  return useView(REMINDER_EDITOR_VIEW)
}
