import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import type { Editor } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { useCallback, useEffect, useRef } from 'react'

/**
 * Reports what an editor made of the content it opened with. Feed it from both
 * `onTransaction` and `onCreate`:
 *
 * ```ts
 * onTransaction: ({ editor, transaction }) => baseline(editor, transaction.before),
 * onCreate: ({ editor }) => baseline(editor),
 * ```
 */
export function useEditorBaseline(
  onBaseline?: (markdown: string) => void,
): (editor: Editor, doc?: Node) => void {
  const report = useRef(onBaseline)
  useEffect(() => {
    report.current = onBaseline
  })

  const reported = useRef(false)

  return useCallback((editor: Editor, doc?: Node) => {
    if (reported.current) return
    reported.current = true
    report.current?.(serializeDocumentToMarkdown(editor, doc))
  }, [])
}
