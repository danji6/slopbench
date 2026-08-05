import { highlightPlugin, tokenColorDecorations } from '@/lib/tiptap/highlight'
import { collectDocText, toPmRange } from '@/lib/tiptap/interpreter-doc'
import { SHELL_PREFIX, shellCommandRange } from '@sb/core/shell/command'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Highlighter } from 'shiki'

/** Bash highlighting for a `$ <command>` message. */
export const ShellHighlight = Extension.create({
  name: 'shellHighlight',

  addProseMirrorPlugins() {
    return [
      highlightPlugin('shellHighlight', {
        syntax: buildSyntax,
        colors: buildColors,
      }),
    ]
  },
})

type ShellDoc = {
  text: string
  positions: number[]
  start: number
  end: number
}

/** The command the document holds, with the text map the decorations need. */
function scanShellCommand(doc: Node): ShellDoc | null {
  // Only a leading paragraph runs, which is what `editorShellCommand` sends
  const first = doc.firstChild
  if (first?.type.name !== 'paragraph') return null
  if (!first.textContent.startsWith(SHELL_PREFIX)) return null

  const { text, positions } = collectDocText(doc)
  const range = shellCommandRange(text)
  return range && { text, positions, start: range[0], end: range[1] }
}

/** Monospace over the whole invocation, with a muted prefix. */
function buildSyntax(doc: Node): DecorationSet {
  const scan = scanShellCommand(doc)
  if (!scan) return DecorationSet.empty

  const decorations: Decoration[] = []
  const mono = toPmRange(scan.positions, 0, scan.end)
  if (mono) {
    decorations.push(
      Decoration.inline(mono[0], mono[1], { class: 'shell-cmd' }),
    )
  }
  const prefix = toPmRange(scan.positions, 0, scan.start)
  if (prefix) {
    decorations.push(
      Decoration.inline(prefix[0], prefix[1], { class: 'shell-cmd-prefix' }),
    )
  }
  return DecorationSet.create(doc, decorations)
}

/** Shiki bash token colors overlaid on the command. */
function buildColors(doc: Node, hl: Highlighter): DecorationSet {
  const scan = scanShellCommand(doc)
  if (!scan) return DecorationSet.empty

  return DecorationSet.create(
    doc,
    tokenColorDecorations(
      scan.text.slice(scan.start, scan.end),
      scan.start,
      scan.positions,
      hl,
      'bash',
    ),
  )
}
