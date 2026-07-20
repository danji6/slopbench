import { Command } from '@/components/ui/command'
import {
  type SnippetStop,
  activateSnippet,
} from '@/lib/tiptap/extensions/snippet-stops'
import { TextSelection, type Transaction } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'
import Fuse from 'fuse.js'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** A single completion entry offered while typing in a code editor. */
export type Completion = {
  /** Matched against the typed word and shown as the primary label. */
  label: string
  /** Secondary text shown on the right. */
  detail?: string
  /**
   * The inserted text. Supports numbered tab stops the user cycles through with
   * Tab (`$1`, `$2`, …), an optional final caret (`$0`), and `${n:label}`
   * placeholders whose label is pre-selected. A bare `$0` positions the caret.
   */
  snippet?: string
}

/**
 * Supplies completions for the current word.
 * Array: fuzzy-matched against the query.
 * Function: receives the query and returns its own matches.
 */
export type CompletionSource = Completion[] | ((query: string) => Completion[])

const WORD_RE = /[\p{L}\p{N}_$]+$/u
/** `$1`, `$2`, … or `${1:label}` tab-stop markers within a snippet. */
const STOP_RE = /\$(\d+)|\$\{(\d+):([^}]*)\}/g
const APPEAR_DELAY_MS = 250

type CompletionContext = {
  query: string
  /** Document range of the word being completed. */
  from: number
  to: number
  /** Viewport coordinates of the word start. */
  left: number
  top: number
}

/**
 * Renders a caret-anchored completion popup for the given editor.
 *
 * @returns the popup element (portal) or `null` when there is nothing to show.
 */
export function useCodeCompletion(
  editor: Editor | null,
  source?: CompletionSource,
): ReactNode {
  const [context, setContext] = useState<CompletionContext | null>(null)
  const dismissedRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownRef = useRef(false)

  useEffect(() => {
    if (!editor) return

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const hide = () => {
      clearTimer()
      shownRef.current = false
      setContext(null)
    }

    const showFromTyping = () => {
      if (!editor.isFocused) {
        hide()
        return
      }

      const next = getCompletionContext(editor)
      if (!next || next.query === dismissedRef.current) {
        if (!next) dismissedRef.current = null
        hide()
        return
      }
      dismissedRef.current = null

      if (shownRef.current) {
        setContext((prev) => (sameContext(prev, next) ? prev : next))
        return
      }

      clearTimer()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        shownRef.current = true
        setContext(next)
      }, APPEAR_DELAY_MS)
    }

    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) showFromTyping()
      else if (transaction.selectionSet) hide()
    }

    editor.on('transaction', onTransaction)
    editor.on('blur', hide)

    return () => {
      clearTimer()
      editor.off('transaction', onTransaction)
      editor.off('blur', hide)
    }
  }, [editor])

  const fuse = useMemo(
    () => (Array.isArray(source) ? makeFuse(source) : null),
    [source],
  )

  if (!editor || !context || !source) return null

  const items =
    typeof source === 'function'
      ? source(context.query)
      : fuse!
          .search(context.query)
          .map((result) => result.item)
          .filter((item) => isRelevantMatch(item.label, context.query))
  if (items.length === 0) return null

  const close = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    shownRef.current = false
    setContext(null)
  }
  const accept = (completion: Completion) => {
    dismissedRef.current = acceptCompletion(editor, context, completion)
    close()
  }
  const dismiss = () => {
    dismissedRef.current = context.query
    close()
  }

  return (
    <CompletionPopup
      context={context}
      items={items}
      onAccept={accept}
      onDismiss={dismiss}
    />
  )
}

function CompletionPopup({
  context,
  items,
  onAccept,
  onDismiss,
}: {
  context: CompletionContext
  items: Completion[]
  onAccept: (completion: Completion) => void
  onDismiss: () => void
}) {
  const [selected, setSelected] = useState(items[0]?.label ?? '')
  const [prevQuery, setPrevQuery] = useState(context.query)

  if (prevQuery !== context.query) {
    setPrevQuery(context.query)
    setSelected(items[0]?.label ?? '')
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const index = items.findIndex((c) => c.label === selected)
      if (e.key === 'ArrowDown') {
        stop(e)
        setSelected(items[(index + 1) % items.length]!.label)
      } else if (e.key === 'ArrowUp') {
        stop(e)
        setSelected(items[(index - 1 + items.length) % items.length]!.label)
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        stop(e)
        const item = items[index] ?? items[0]!
        onAccept(item)
      } else if (e.key === 'Escape') {
        stop(e)
        onDismiss()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [items, selected, onAccept, onDismiss])

  return createPortal(
    <div
      data-slot="code-completion"
      onMouseDown={(e) => e.preventDefault()} // keep editor focus when an item is clicked
      className="bg-m3-surface-container-low fixed z-55 w-72 overflow-hidden rounded-xl border shadow-lg"
      style={{ left: context.left, top: context.top + 4 }}
    >
      <Command
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
      >
        <Command.CommandList>
          {items.map((item) => (
            <Command.CommandItem
              key={item.label}
              value={item.label}
              onSelect={() => onAccept(item)}
              className="flex items-center gap-3 rounded-lg px-3 py-2"
            >
              <span className="font-mono text-sm">{item.label}</span>
              {item.detail && (
                <Command.CommandShortcut>{item.detail}</Command.CommandShortcut>
              )}
            </Command.CommandItem>
          ))}
        </Command.CommandList>
      </Command>
    </div>,
    document.body,
  )
}

function stop(e: KeyboardEvent) {
  e.preventDefault()
  e.stopPropagation()
}

function getCompletionContext(editor: Editor): CompletionContext | null {
  const { state, view } = editor
  const { from, empty } = state.selection
  if (!empty) return null

  const $pos = state.doc.resolve(from)
  if ($pos.parent.type.name !== 'codeBlock') return null

  const before = $pos.parent.textBetween(0, $pos.parentOffset, '\n')
  const match = before.match(WORD_RE)
  if (!match) return null

  const wordFrom = from - match[0].length
  const coords = view.coordsAtPos(wordFrom)
  return {
    query: match[0],
    from: wordFrom,
    to: from,
    left: coords.left,
    top: coords.bottom,
  }
}

/** Inserts a completion and returns the word before the first stop, if any. */
function acceptCompletion(
  editor: Editor,
  context: CompletionContext,
  completion: Completion,
): string | null {
  const { text, stops } = parseSnippet(completion.snippet ?? completion.label)
  const first = stops[0] ?? { start: text.length, end: text.length }

  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.insertText(text, context.from, context.to)
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          context.from + first.start,
          context.from + first.end,
        ),
      )
      return true
    })
    .run()

  const absolute: SnippetStop[] = stops.map((stop) => ({
    from: context.from + stop.start,
    to: context.from + stop.end,
  }))
  activateSnippet(editor.view, absolute)

  return text.slice(0, first.start).match(WORD_RE)?.[0] ?? null
}

/** A tab stop's offsets relative to the start of the inserted text. */
type ParsedStop = { start: number; end: number }

/**
 * Expands a snippet into plain text plus ordered tab stops. Stops are sorted by
 * their number, with `$0` (the exit caret) always placed last.
 */
function parseSnippet(snippet: string): { text: string; stops: ParsedStop[] } {
  let text = ''
  let last = 0
  const numbered: { num: number; start: number; end: number }[] = []

  for (const match of snippet.matchAll(STOP_RE)) {
    text += snippet.slice(last, match.index)
    last = match.index + match[0].length
    const num = Number(match[1] ?? match[2])
    const label = match[3] ?? ''
    const start = text.length
    text += label
    numbered.push({ num, start, end: text.length })
  }
  text += snippet.slice(last)

  numbered.sort((a, b) => stopRank(a.num) - stopRank(b.num))
  return { text, stops: numbered.map(({ start, end }) => ({ start, end })) }
}

/** `$0` is the final stop; everything else keeps its natural order. */
const stopRank = (num: number) => (num === 0 ? Infinity : num)

function makeFuse(completions: Completion[]): Fuse<Completion> {
  return new Fuse(completions, {
    keys: ['label'],
    threshold: 0.6,
    ignoreLocation: false,
    isCaseSensitive: false,
  })
}

/** A camelCase or post-separator word boundary within a label. */
function isWordBoundary(label: string, i: number): boolean {
  if (i === 0) return true
  const c = label[i]!
  const prev = label[i - 1]!
  if (/[A-Z]/.test(c) && /[a-z0-9]/.test(prev)) return true
  return /[A-Za-z0-9]/.test(c) && /[^A-Za-z0-9]/.test(prev)
}

/** Whether a Fuse candidate is relevant enough to show. */
function isRelevantMatch(label: string, query: string): boolean {
  return isAbbreviationMatch(label, query) || isPrefixTypo(label, query)
}

/**
 * True when each query character lands on a word boundary or continues the
 * current word, and the match opens at the start or with a run of at least two
 * characters.
 */
function isAbbreviationMatch(label: string, query: string): boolean {
  const lower = label.toLowerCase()
  const q = query.toLowerCase()
  let li = 0
  let firstStart = -1
  let firstRun = 0

  for (let qi = 0; qi < q.length;) {
    let pos = -1
    for (let i = li; i < lower.length; i++) {
      if (isWordBoundary(label, i) && lower[i] === q[qi]) {
        pos = i
        break
      }
    }
    if (pos === -1) return false

    li = pos
    let run = 0
    while (qi < q.length && li < lower.length && lower[li] === q[qi]) {
      qi++
      li++
      run++
    }
    if (firstStart === -1) {
      firstStart = pos
      firstRun = run
    }
  }

  return firstStart === 0 || firstRun >= 2
}

/**
 * True when the query is within a small edit distance of the label's prefix,
 * allowing one error every four characters.
 */
function isPrefixTypo(label: string, query: string): boolean {
  const maxEdits = Math.floor(query.length / 4)
  if (maxEdits === 0) return false
  const prefix = label.toLowerCase().slice(0, query.length)
  return editDistance(query.toLowerCase(), prefix) <= maxEdits
}

/** Levenshtein distance between two strings. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!)
    }
    prev = curr
  }
  return prev[b.length]!
}

function sameContext(
  a: CompletionContext | null,
  b: CompletionContext,
): boolean {
  return (
    a !== null &&
    a.query === b.query &&
    a.from === b.from &&
    a.to === b.to &&
    a.left === b.left &&
    a.top === b.top
  )
}
