import {
  CompletionController,
  type CompletionSession,
} from '@/lib/completion/controller'
import {
  type CompletionDocumentSource,
  codeCompletionDocument,
} from '@/lib/completion/document'
import { staticCompletions } from '@sb/core/code-completion/engine'
import type { CompletionSource } from '@sb/core/code-completion/types'
import type { Editor } from '@tiptap/react'
import { type ReactNode, useEffect, useId, useMemo, useState } from 'react'

import { CompletionPopup } from './completion-popup'

export type {
  Completion,
  CompletionSource,
} from '@sb/core/code-completion/types'

type CompletionOptions = {
  language?: string
  document?: CompletionDocumentSource
}

/** Connects reusable providers to a Tiptap editor and accessible completion UI. */
export function useCodeCompletion(
  editor: Editor | null,
  source?: CompletionSource,
  options: CompletionOptions = {},
): ReactNode {
  const { language = 'javascript', document = codeCompletionDocument } = options
  const [session, setSession] = useState<CompletionSession | null>(null)
  const id = useId()

  const controller = useMemo(() => {
    if (!editor || !source) return null
    return new CompletionController({
      editor,
      provider: staticCompletions(source),
      language,
      document,
      onChange: setSession,
    })
  }, [editor, source, language, document])

  useEffect(() => controller?.connect(), [controller])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const dom = editor.view.dom
    const expanded = !!session?.items.length
    dom.setAttribute('aria-autocomplete', 'list')
    dom.setAttribute('aria-expanded', String(expanded))
    if (expanded) {
      dom.setAttribute('aria-controls', id)
      dom.setAttribute('aria-activedescendant', `${id}-${session!.selected}`)
    } else {
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
    }

    return () => {
      for (const name of [
        'aria-autocomplete',
        'aria-expanded',
        'aria-controls',
        'aria-activedescendant',
      ]) {
        dom.removeAttribute(name)
      }
    }
  }, [editor, session, id])

  if (!editor || !controller || !session) return null

  const anchor = session.map.toDocument(session.map.offset, 'start')
  if (anchor === null || anchor > editor.state.doc.content.size) return null

  return (
    <CompletionPopup
      editor={editor}
      anchor={anchor}
      id={id}
      items={session.items}
      selected={session.selected}
      signature={session.signature}
      onAccept={controller.accept}
      onSelect={controller.select}
    />
  )
}
