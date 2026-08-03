import { useEditorDraft } from '@/lib/chat/editor-draft-store'
import { useEffect, useMemo } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'

/** What the form itself accepts as a full reset. */
type StoredValues<T extends FieldValues> = Parameters<
  UseFormReturn<T>['reset']
>[0]

export type FormDraft<T extends FieldValues> = {
  /** Loads the stored values, offering a draft if present. */
  sync: (values: StoredValues<T>) => void
  /** Drops the draft once its values are persisted or explicitly discarded. */
  clear: () => void
}

/** Persists a settings form's unsaved values locally to prevent data loss. */
export function useFormDraft<T extends FieldValues>(
  key: string | undefined,
  form: UseFormReturn<T>,
  /** Names the draft in the confirmation: "unsaved changes to <label>". */
  label: string,
  /** Strips what must not reach local storage. Must be referentially stable. */
  sanitize?: (values: T) => T,
): FormDraft<T> {
  const draft = useEditorDraft<T>(key, label)

  useEffect(() => {
    return form.subscribe({
      formState: { values: true, isDirty: true },
      callback: ({ values, isDirty }) => {
        if (isDirty) draft.save(sanitize ? sanitize(values as T) : values)
        else draft.clearUnchanged()
      },
    })
  }, [form, draft, sanitize])

  return useMemo(
    () => ({
      sync: (values: StoredValues<T>) => {
        // Ask to restore before a reset, since a reset reports the form as clean
        // and a clean form is otherwise read as the user reverting their edits
        draft.restore((saved) => form.reset(saved, { keepDefaultValues: true }))
        form.reset(values)
      },
      clear: draft.clear,
    }),
    [draft, form],
  )
}
