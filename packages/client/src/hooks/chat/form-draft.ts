import { useEditorDraft } from '@/lib/chat/editor-draft-store'
import { useEffect, useMemo } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

export type FormDraft = {
  /** Offers any stored draft, layering it over the form once accepted. */
  restore: () => void
  /** Drops the draft once its values are persisted or explicitly discarded. */
  clear: () => void
}

/** Persists a settings form's unsaved values locally to prevent data loss. */
export function useFormDraft<T extends FieldValues>(
  key: string | undefined,
  form: UseFormReturn<T>,
  /** Names the draft in the confirmation: "unsaved changes to <label>". */
  label: string,
): FormDraft {
  const draft = useEditorDraft<T>(key, label)

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
      restore: () =>
        draft.restore((saved) =>
          form.reset(saved, { keepDefaultValues: true }),
        ),
      clear: draft.clear,
    }),
    [draft, form],
  )
}
