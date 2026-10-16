import { collectCompletions } from '@sb/core/code-completion/engine'
import type {
  CompletionItem,
  CompletionProvider,
  CompletionRequest,
  CompletionResult,
} from '@sb/core/code-completion/types'
import type { Node } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

import {
  type CompletionDocument,
  type CompletionDocumentSource,
} from './document'
import { applyCompletion } from './edits'

export type CompletionSession = CompletionResult & {
  map: CompletionDocument
  doc: Node
  selected: number
}

type ControllerOptions = {
  editor: Editor
  provider: CompletionProvider
  language: string
  document: CompletionDocumentSource
  onChange: (session: CompletionSession | null) => void
}

/** Coordinates editor events, delayed suggestions, and asynchronous requests. */
export class CompletionController {
  private revision = 0
  private timer?: ReturnType<typeof setTimeout>
  private session: CompletionSession | null = null
  private composing = false
  private applying = false
  private dismissed: string | undefined

  constructor(private options: ControllerOptions) {}

  connect(): () => void {
    const { editor } = this.options
    editor.on('transaction', this.onTransaction)
    editor.on('blur', this.hide)

    const dom = editor.view.dom
    dom.addEventListener('keydown', this.onKeyDown, true)
    dom.addEventListener('compositionstart', this.onCompositionStart)
    dom.addEventListener('compositionend', this.onCompositionEnd)

    return () => {
      this.hide()
      editor.off('transaction', this.onTransaction)
      editor.off('blur', this.hide)
      dom.removeEventListener('keydown', this.onKeyDown, true)
      dom.removeEventListener('compositionstart', this.onCompositionStart)
      dom.removeEventListener('compositionend', this.onCompositionEnd)
    }
  }

  select = (selected: number) => {
    if (!this.session || !Number.isInteger(selected)) return
    if (selected < 0 || selected >= this.session.items.length) return
    this.publish({ ...this.session, selected })
  }

  accept = (item: CompletionItem) => {
    const { editor } = this.options
    const session = this.session
    if (!session || !this.isCurrent(session)) return this.hide()
    this.applying = true
    this.hide()
    try {
      applyCompletion(editor, session.map, item)
    } finally {
      this.applying = false
    }
    // A function snippet can place the caret directly in a completable argument
    this.request(item.snippet !== undefined ? 'triggerCharacter' : 'selection')
  }

  private publish(session: CompletionSession | null) {
    this.session = session
    this.options.onChange(session)
  }

  private hide = () => {
    this.revision++
    clearTimeout(this.timer)
    this.publish(null)
  }

  private isCurrent(session: CompletionSession): boolean {
    const { editor } = this.options
    if (editor.isDestroyed || !editor.isFocused || this.composing) return false
    const current = this.options.document(editor)
    return (
      editor.state.doc === session.doc && current?.offset === session.map.offset
    )
  }

  private request(trigger: CompletionRequest['trigger']) {
    const { editor, document, language, provider } = this.options
    if (this.composing || editor.view.composing || !editor.isFocused)
      return this.hide()

    const map = document(editor)
    if (!map) return this.hide()

    const revision = ++this.revision
    clearTimeout(this.timer)
    const key = `${map.offset}:${map.text}`
    if (trigger === 'explicit') this.dismissed = undefined
    if (key === this.dismissed) return

    this.dismissed = undefined
    const hadItems = !!this.session?.items.length
    const snapshot = { map, doc: editor.state.doc, selected: 0 }

    void collectCompletions([provider], {
      text: map.text,
      offset: map.offset,
      language,
      trigger,
    }).then((result) => {
      if (
        revision !== this.revision ||
        !this.isCurrent({ ...snapshot, items: [] })
      ) {
        return
      }

      const session = { ...snapshot, ...result }
      const delayed = trigger === 'typing' && !hadItems && result.items.length > 0 // prettier-ignore

      if (delayed) {
        this.publish(result.signature ? { ...session, items: [] } : null)
        this.timer = setTimeout(() => {
          if (revision === this.revision && this.isCurrent(session))
            this.publish(session)
        }, 250)
      } else {
        this.publish(result.items.length || result.signature ? session : null)
      }
    })
  }

  private onTransaction = ({ transaction }: { transaction: Transaction }) => {
    if (this.applying) return
    if (
      transaction.docChanged &&
      transaction.getMeta('preventUpdate') !== undefined
    ) {
      this.hide()
      return
    }
    if (transaction.docChanged) {
      const { editor } = this.options
      const map = this.options.document(editor)
      const previous = map?.text[map.offset - 1]
      const trigger =
        previous && ['(', ',', "'", '"'].includes(previous)
          ? 'triggerCharacter'
          : 'typing'
      this.request(trigger)
    } else if (transaction.selectionSet) {
      this.hide()
      this.request('selection')
    }
  }

  private onKeyDown = (event: KeyboardEvent) => {
    const { editor } = this.options

    if (
      this.composing ||
      editor.view.composing ||
      event.isComposing ||
      !editor.isFocused
    ) {
      return
    }
    if (event.ctrlKey && event.code === 'Space') {
      consume(event)
      this.request('explicit')
      return
    }

    const session = this.session
    if (!session || !this.isCurrent(session)) return

    const count = session.items.length

    if (event.key === 'Escape') {
      consume(event)
      this.revision++
      clearTimeout(this.timer)
      if (count > 0 && session.signature)
        this.publish({ ...session, items: [] })
      else this.publish(null)
      this.dismissed = `${session.map.offset}:${session.map.text}`
    } else if (
      count > 0 &&
      ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key)
    ) {
      consume(event)
      if (event.key === 'ArrowDown') this.select((session.selected + 1) % count)
      else if (event.key === 'ArrowUp')
        this.select((session.selected - 1 + count) % count)
      else this.accept(session.items[session.selected]!)
    }
  }

  private onCompositionStart = () => {
    this.composing = true
    this.hide()
  }

  private onCompositionEnd = () => {
    this.composing = false
    this.hide()
  }
}

function consume(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopImmediatePropagation()
}
