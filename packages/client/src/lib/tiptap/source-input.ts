import type { SourceSpan } from '@/lib/tiptap/inline-source'
import type { ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { DecorationSet, EditorView } from '@tiptap/pm/view'

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
type SourceInputState = { spans: SourceSpan[]; decorations: DecorationSet }

/** Handles unmodified character editing around hidden source delimiters. */
export function handleSourceKey(
  view: EditorView,
  event: KeyboardEvent,
  source?: SourceInputState,
): boolean {
  if (!source || view.composing || event.isComposing) return false
  const modified = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey // prettier-ignore
  if (modified) return false

  if (event.key === 'Backspace' || event.key === 'Delete') {
    const direction = event.key === 'Backspace' ? -1 : 1
    return deleteSourceCharacter(view, source.spans, direction)
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    return moveIntoHiddenSource(view, source.decorations, direction)
  }

  return false
}

/** Keeps native input from placing edits inside hidden source characters. */
export function handleSourceBeforeInput(
  view: EditorView,
  event: InputEvent,
  source?: SourceInputState,
): boolean {
  if (!source || event.isComposing || !event.cancelable) return false
  if (event.inputType === 'insertText' && event.data) {
    if (!insertBesideHiddenSource(view, source.decorations, event.data))
      return false
    event.preventDefault()
    return true
  }

  const direction =
    event.inputType === 'deleteContentBackward'
      ? -1
      : event.inputType === 'deleteContentForward'
        ? 1
        : null

  if (!direction || !deleteSourceCharacter(view, source.spans, direction))
    return false

  event.preventDefault()
  return true
}

/** Inserts at the model caret before the browser can shift it into hidden text. */
function insertBesideHiddenSource(
  view: EditorView,
  decorations: DecorationSet,
  text: string,
): boolean {
  if (view.composing || !view.editable) return false

  const { selection } = view.state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  const pos = selection.from
  const touchesHiddenSource =
    decorations.find(pos, pos, (spec) => spec.hiddenSource === true).length > 0
  if (!touchesHiddenSource) return false

  const insert = () => view.state.tr.insertText(text, pos, pos).scrollIntoView()

  const handled = view.someProp('handleTextInput', (handler) =>
    handler(view, pos, pos, text, insert),
  )
  if (!handled) view.dispatch(insert())

  return true
}

/** Deletes one grapheme without letting native editing consume hidden neighbors. */
function deleteSourceCharacter(
  view: EditorView,
  spans: SourceSpan[],
  direction: -1 | 1,
): boolean {
  const { state } = view
  if (view.composing || !view.editable) {
    return false
  }
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) {
    return false
  }

  const { $from, from: pos } = state.selection
  const from = pos - (direction === -1 ? 1 : 0)
  const touchesSource = spans.some((span) => from >= span.from - 1 && from <= span.to) // prettier-ignore
  if (!touchesSource) return false

  const next = adjacentGrapheme($from, direction)
  if (next === pos) return false

  view.dispatch(
    state.tr.delete(Math.min(pos, next), Math.max(pos, next)).scrollIntoView(),
  )

  return true
}

/** Moves one source character into a hidden delimiter and reveals it. */
function moveIntoHiddenSource(
  view: EditorView,
  decorations: DecorationSet,
  direction: -1 | 1,
): boolean {
  const { state } = view
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  const pos = selection.from
  const entersHiddenSource = decorations
    .find(pos - 1, pos + 1, (spec) => spec.hiddenSource === true)
    .some((range) =>
      direction === 1
        ? pos >= range.from && pos < range.to
        : pos > range.from && pos <= range.to,
    )
  if (!entersHiddenSource) return false

  const next = adjacentGrapheme(selection.$from, direction)
  const target = TextSelection.near(state.doc.resolve(next), direction)
  view.dispatch(state.tr.setSelection(target).scrollIntoView())

  return true
}

function adjacentGrapheme($edge: ResolvedPos, direction: -1 | 1): number {
  const text = $edge.parent.textBetween(
    0,
    $edge.parent.content.size,
    '',
    '\ufffc',
  )
  const offset = $edge.parentOffset
  const segment = graphemes
    .segment(text)
    .containing(direction === -1 ? offset - 1 : offset)

  return segment
    ? $edge.start() +
        segment.index +
        (direction === 1 ? segment.segment.length : 0)
    : $edge.pos
}
