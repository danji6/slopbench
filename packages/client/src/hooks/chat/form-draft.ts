import { useEditorDraft } from '@/lib/chat/editor-draft-store'
import { useEffect, useMemo } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

export type FormDraft = {
  /** Layers any stored draft over the form, right after it is populated. */
  restore: () => void
  /** Drops the draft once its values are persisted or explicitly discarded. */
  clear: () => void
}

/** Persists a settings form's unsaved values locally to prevent data loss. */
export function useFormDraft<T extends FieldValues>(
  key: string | undefined,
  form: UseFormReturn<T>,
): FormDraft {
  const draft = useEditorDraft<T>(key)

  useEffect(() => {
    return form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ values, isDirty }) => {
        if (isDirty) draft.save(values)
      },
    })
  }, [form, draft])

  return useMemo(
    () => ({
      restore: () => {
        const saved = draft.read()
        if (saved) form.reset(saved, { keepDefaultValues: true })
      },
      clear: draft.clear,
    }),
    [draft, form],
  )
}
