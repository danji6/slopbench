import { type ViewHandle, useView } from '@/hooks/view'

/**
 * `?view=` segments owned by the prompt editors, nested below whichever
 * settings dialog owns the list. Each segment value is an item id.
 */
export const PROMPT_EDITOR_VIEW = 'prompt'
export const LIBRARY_PROMPT_EDITOR_VIEW = 'library'
export const REMINDER_EDITOR_VIEW = 'reminder'

/** The agent's ordered prompt list. */
export function usePromptEditorView(): ViewHandle {
  return useView(PROMPT_EDITOR_VIEW)
}

export function useLibraryPromptEditorView(): ViewHandle {
  return useView(LIBRARY_PROMPT_EDITOR_VIEW)
}

export function useReminderEditorView(): ViewHandle {
  return useView(REMINDER_EDITOR_VIEW)
}

/** Keeps the two operation editors independent within the same settings view. */
export function useOperationPromptEditorView(
  kind: 'compaction' | 'impersonation',
): ViewHandle {
  return useView(kind)
}
