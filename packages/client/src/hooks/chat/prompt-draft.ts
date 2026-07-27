import { useEditorDraft } from '@/lib/chat/editor-draft-store'
import type { EditorDocumentHandle } from '@/lib/tiptap/handle'
import type { JSONContent } from '@tiptap/core'
import type { RefObject } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { useWatch } from 'react-hook-form'

/** Form values of an editor whose content is written with a markdown editor. */
type WithContent = FieldValues & { content: string }

/** A draft of one prompt form. */
type PromptDraftValue<T> = {
  values: T
  /** The document the content editor held. */
  doc?: JSONContent
  /** The content these values were measured as changes against. */
  baseline?: string
}

/** Drafts written before the document and the baseline were kept with them. */
type StoredPromptDraft<T> = PromptDraftValue<T> | T

function asDraft<T extends WithContent>(
  stored: StoredPromptDraft<T>,
): PromptDraftValue<T> {
  return 'values' in stored
    ? (stored as PromptDraftValue<T>)
    : { values: stored as T }
}

export type PromptDraftOptions<T extends WithContent> = {
  /** Draft key for the prompt being edited. */
  key: string
  /** Names the draft in the confirmation: "unsaved changes to <label>". */
  label: string
  form: UseFormReturn<T>
  /** The content editor, which holds the document a draft is restored from. */
  content: RefObject<EditorDocumentHandle | null>
  /** Content as stored. */
  stored: string
  /** Whether the editor is on screen. */
  open: boolean
  /** Stored values, returned to when the editor closes with nothing unsaved. */
  initial: () => T
}

export type PromptDraft = {
  /** Give this to the content editor's `onBaseline`. */
  onBaseline: (markdown: string) => void
  /** Give this to the content editor's `doc`, to reopen a restored draft on. */
  doc: JSONContent | undefined
  /** Drops the draft, once its values are saved or explicitly discarded. */
  clear: () => void
}

/**
 * Keeps a prompt form's unsaved values, offering them back the next time
 * that prompt is opened.
 *
 * Since parsing can reformat markdown, dirtiness is calculated on the editor's
 * restored content rather than the stored string itself.
 */
export function usePromptDraft<T extends WithContent>({
  key,
  label,
  form,
  content,
  stored,
  open,
  initial,
}: PromptDraftOptions<T>): PromptDraft {
  const draft = useEditorDraft<StoredPromptDraft<T>>(key, label)
  const { control, getValues, reset } = form
  const { isDirty } = form.formState

  const [doc, setDoc] = useState<JSONContent>()
  const baseline = useRef<string>(undefined)
  const asked = useRef<string | null>(null)

  useEffect(() => {
    if (asked.current === key) return
    asked.current = key
    draft.restore((saved) => {
      const restored = asDraft(saved)
      if (restored.baseline !== undefined) {
        baseline.current = restored.baseline
        reset({ ...initial(), content: restored.baseline })
      }
      setDoc(restored.doc)
      reset(restored.values, { keepDefaultValues: true })
    })
  }, [key, draft, reset, initial])

  const watched = useWatch({ control })
  useEffect(() => {
    if (isDirty)
      draft.save({
        values: watched as T,
        doc: content.current?.read(),
        baseline: baseline.current,
      })
    else draft.clearUnchanged()
  }, [watched, isDirty, draft, content])

  useEffect(() => {
    if (open || draft.read()) return
    reset(initial())
  }, [open, draft, reset, initial])

  return {
    doc,
    onBaseline: useCallback(
      (markdown: string) => {
        if (getValues().content !== stored) return
        baseline.current = markdown
        reset({ ...getValues(), content: markdown })
      },
      [getValues, reset, stored],
    ),
    clear: useCallback(() => {
      baseline.current = getValues().content
      draft.clear()
    }, [draft, getValues]),
  }
}
