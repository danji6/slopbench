import type { AnsiLine } from '@sb/core/shell/ansi-scanner'
import { createAnsiScanner } from '@sb/core/shell/ansi-scanner'

import { SCROLLBACK_LINES } from './terminal-feed'

const PIN_SLACK_PX = 4

export type TextTerminal = {
  write: (data: string) => void
  clear: () => void
  fit: () => void
  /** Writes anything buffered before the elements mounted. */
  flush: () => void
}

export type TextTerminalElements = {
  /** The scrolling viewport. */
  scroll: () => HTMLElement | null
  /** The block the rendered lines are appended to. */
  lines: () => HTMLElement | null
}

/** Imperative terminal text renderer. Kept outside React for performance. */
export function createTextTerminal(
  elements: TextTerminalElements,
): TextTerminal {
  const scanner = createAnsiScanner()
  let pending = ''
  let openLine: HTMLElement | null = null
  let count = 0

  const appendLine = (parent: HTMLElement) => {
    const line = parent.ownerDocument.createElement('div')
    // Keeps blank lines from collapsing
    line.style.minHeight = '1lh'
    parent.appendChild(line)
    count += 1
    return line
  }

  const trim = (parent: HTMLElement) => {
    while (count > SCROLLBACK_LINES && parent.firstChild) {
      parent.removeChild(parent.firstChild)
      count -= 1
    }
  }

  const write = (data: string) => {
    const parent = elements.lines()
    if (!parent) {
      pending += data
      return
    }

    const viewport = elements.scroll()
    const pinned = isPinned(viewport)
    const { completed, current } = scanner.push(data)

    let target = openLine ?? appendLine(parent)
    for (const ansi of completed) {
      renderLine(target, ansi)
      target = appendLine(parent)
    }
    renderLine(target, current)
    openLine = target

    trim(parent)
    if (pinned && viewport) viewport.scrollTop = viewport.scrollHeight
  }

  return {
    write,
    clear: () => {
      pending = ''
      scanner.reset()
      openLine = null
      count = 0
      elements.lines()?.replaceChildren()
    },
    fit: () => {},
    flush: () => {
      if (!pending) return
      const data = pending
      pending = ''
      write(data)
    },
  }
}

function renderLine(line: HTMLElement, ansi: AnsiLine[]): void {
  line.replaceChildren(...ansi.map((ansi) => toNode(line.ownerDocument, ansi)))
}

function toNode(document: Document, ansi: AnsiLine): Node {
  const { fg, bg, bold, dim, italic, underline, strike } = ansi.style
  if (!fg && !bg && !bold && !dim && !italic && !underline && !strike) {
    return document.createTextNode(ansi.text)
  }

  const span = document.createElement('span')
  span.textContent = ansi.text
  if (fg) span.style.color = fg
  if (bg) span.style.backgroundColor = bg
  if (bold) span.style.fontWeight = '600'
  if (dim) span.style.opacity = '0.65'
  if (italic) span.style.fontStyle = 'italic'

  const decoration = [underline && 'underline', strike && 'line-through']
    .filter(Boolean)
    .join(' ')
  if (decoration) span.style.textDecoration = decoration
  return span
}

function isPinned(element: HTMLElement | null): boolean {
  if (!element) return true
  const { scrollTop, clientHeight, scrollHeight } = element
  return scrollTop + clientHeight >= scrollHeight - PIN_SLACK_PX
}
