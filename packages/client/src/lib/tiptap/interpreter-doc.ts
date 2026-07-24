import type { Node } from '@tiptap/pm/model'

/**
 * A document flattened to the plain text the interpreter sees, plus a map from
 * each character to its ProseMirror position.
 */
export type DocText = { text: string; positions: number[] }

/** Flattens text blocks into a DocText. */
export function collectDocText(doc: Node): DocText {
  const acc: DocText = { text: '', positions: [] }
  let first = true

  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (!node.isTextblock) return

    if (!first) {
      acc.text += '\n'
      acc.positions.push(pos)
    }
    first = false
    appendInline(acc, node, pos)
    return false
  })

  return acc
}

/** The global text offset for a ProseMirror position. */
export function offsetAt(map: DocText, pmPos: number): number {
  let count = 0
  for (const p of map.positions) if (p < pmPos) count++
  return count
}

/** Maps a `[from, to)` text range to a ProseMirror `[start, end)` range. */
export function toPmRange(
  positions: number[],
  from: number,
  to: number,
): [number, number] | null {
  if (to <= from || from >= positions.length) return null
  const end = Math.min(to, positions.length)
  return [positions[from], positions[end - 1] + 1]
}

/** Appends a text block's inline content, hard breaks becoming newlines. */
function appendInline(acc: DocText, node: Node, pos: number): void {
  node.descendants((child, childPos) => {
    const base = pos + 1 + childPos
    if (child.isText && child.text) {
      for (let i = 0; i < child.text.length; i++) {
        acc.text += child.text[i]
        acc.positions.push(base + i)
      }
    } else if (child.type.name === 'hardBreak') {
      acc.text += '\n'
      acc.positions.push(base)
    }
  })
}
