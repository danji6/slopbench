import type { EditCaret } from './editor/message-edit-context'

export type CarriedEditSelection = {
  selectedText: string
  occurrenceIndex: number
  caret?: EditCaret
  caretOffset: number
  viewportTop?: number
}

export type CarriedEditSelections = {
  block?: CarriedEditSelection
  message?: CarriedEditSelection
}

export type MessageEditSelectionSnapshot = {
  caret?: EditCaret
  caretOffset?: number
  viewportTop: number
  carried: CarriedEditSelections
}

export type MessageEditSelectionOptions = {
  selectedText?: string
  occurrenceIndex?: number
  caret?: EditCaret
  caretOffset?: number
  viewportTop?: number
}

export function captureMessageEditSelection(
  messageId: string,
  x: number,
  y: number,
): MessageEditSelectionSnapshot {
  const caret = editCaretFromPoint(x, y)
  return {
    caret,
    caretOffset: caret?.kind === 'text' ? caret.offset : undefined,
    viewportTop: y,
    carried: carriedSelectionsInRow(messageId, x, y),
  }
}

export function messageEditSelectionOptions(
  snapshot: MessageEditSelectionSnapshot | null,
  target: keyof CarriedEditSelections,
): MessageEditSelectionOptions {
  return (
    snapshot?.carried[target] ?? {
      caret: snapshot?.caret,
      caretOffset: snapshot?.caretOffset,
      viewportTop: snapshot?.viewportTop,
    }
  )
}

const normalizeOffset = (s: string) =>
  s
    .replace(/\s+/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')

type CaretPoint = { node: Node; offset: number }

function caretFromPoint(x: number, y: number): CaretPoint | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y)
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null
  }
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null
  }
  return null
}

function editCaretFromPoint(x: number, y: number): EditCaret | undefined {
  const caret = caretFromPoint(x, y)
  if (!caret) return undefined

  const codeCaret = codeCaretFromPoint(caret, x, y)
  if (codeCaret) return codeCaret

  const offset = textCaretOffset(caret)
  return offset == null ? undefined : { kind: 'text', offset }
}

function textCaretOffset(caret: CaretPoint): number | undefined {
  const el =
    caret.node.nodeType === Node.TEXT_NODE
      ? caret.node.parentElement
      : (caret.node as Element)
  const block = el?.closest('[data-slot="text-block"]')
  if (!block) return undefined

  const before = document.createRange()
  before.selectNodeContents(block)
  try {
    before.setEnd(caret.node, caret.offset)
  } catch {
    return undefined
  }
  return normalizeOffset(before.toString()).length
}

function codeCaretFromPoint(
  caret: CaretPoint,
  x: number,
  y: number,
): EditCaret | undefined {
  const codeSurface = codeSurfaceFromPoint(caret, x, y)
  const block = codeSurface?.closest('[data-slot="text-block"]')
  if (!(codeSurface instanceof HTMLElement) || !block) return undefined
  if (!codeSurface.contains(caret.node)) return undefined

  const before = document.createRange()
  before.selectNodeContents(codeSurface)
  try {
    before.setEnd(caret.node, caret.offset)
  } catch {
    return undefined
  }

  const blockIndex = Array.from(
    block.querySelectorAll('[data-slot="code-surface"]'),
  ).indexOf(codeSurface)
  if (blockIndex === -1) return undefined

  return {
    kind: 'code',
    blockIndex,
    offset: before.toString().length,
  }
}

function codeSurfaceFromPoint(
  caret: CaretPoint,
  x: number,
  y: number,
): HTMLElement | null {
  return (
    closestElement(caret.node, '[data-slot="code-surface"]') ??
    closestElementFromPoint(x, y, '[data-slot="code-surface"]')
  )
}

function carriedSelectionsInRow(
  messageId: string,
  x: number,
  y: number,
): CarriedEditSelections {
  const row = messageRowFromPoint(messageId, x, y)
  if (!row) return {}

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return {}
  }

  const range = selection.getRangeAt(0)
  const block = selectedTextBlock(row, range)
  if (!block) return {}

  const carried = carriedSelectionInContainer(block, range)
  return carried ? { block: carried, message: carried } : {}
}

function messageRowFromPoint(
  messageId: string,
  x: number,
  y: number,
): HTMLElement | null {
  const element = document.elementFromPoint(x, y)
  const row = element?.closest('[data-slot="message-row"]')
  if (!(row instanceof HTMLElement)) return null
  return row.dataset.messageId === messageId ? row : null
}

function selectedTextBlock(
  row: HTMLElement,
  range: Range,
): HTMLElement | null {
  const startBlock = closestElement(
    range.startContainer,
    '[data-slot="text-block"]',
  )
  const endBlock = closestElement(range.endContainer, '[data-slot="text-block"]')
  if (!startBlock || startBlock !== endBlock) return null
  if (!row.contains(startBlock)) return null
  return startBlock
}

function closestElement(node: Node, selector: string): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  const closest = element?.closest(selector)
  return closest instanceof HTMLElement ? closest : null
}

function closestElementFromPoint(
  x: number,
  y: number,
  selector: string,
): HTMLElement | null {
  const closest = document.elementFromPoint(x, y)?.closest(selector)
  return closest instanceof HTMLElement ? closest : null
}

function carriedSelectionInContainer(
  container: HTMLElement,
  range: Range,
): CarriedEditSelection | null {
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return null
  }

  const selectedText = range.toString().trim()
  const strippedText = normalizeOffset(selectedText)
  if (!strippedText) return null

  const before = document.createRange()
  before.selectNodeContents(container)
  try {
    before.setEnd(range.startContainer, range.startOffset)
  } catch {
    return null
  }

  const caretOffset = normalizeOffset(before.toString()).length
  const containerText = normalizeOffset(container.textContent ?? '')
  if (!containerText.includes(strippedText)) return null

  let occurrenceIndex = 0
  let searchPos = 0
  while (searchPos < caretOffset) {
    const idx = containerText.indexOf(strippedText, searchPos)
    if (idx === -1 || idx >= caretOffset) break
    occurrenceIndex++
    searchPos = idx + strippedText.length
  }

  return {
    selectedText,
    occurrenceIndex,
    caret: { kind: 'text', offset: caretOffset },
    caretOffset,
    viewportTop: selectionTop(range),
  }
}

function selectionTop(range: Range): number | undefined {
  const rect = range.getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect.top
  const firstRect = Array.from(range.getClientRects()).find(
    (r) => r.width > 0 || r.height > 0,
  )
  return firstRect?.top
}
