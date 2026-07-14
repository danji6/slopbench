import { Extension } from '@tiptap/core'

type MathToken = { type: 'math'; raw: string; text: string }

/** Matches leading `$$…$$` (display, may span lines). */
const DISPLAY = /^\$\$((?:(?!\$\$)[\s\S])+)\$\$/
/** Matches a leading single-line `$…$` (inline). */
const INLINE = /^\$([^$\n]+)\$/

function tokenizeMath(src: string): MathToken | undefined {
  if (src.startsWith('$$')) {
    const m = DISPLAY.exec(src)
    if (m && m[1].trim()) return { type: 'math', raw: m[0], text: m[0] }
    return undefined
  }
  if (src[0] === '$') {
    const inner = INLINE.exec(src)?.[1]
    // remark-math's single-dollar guard: no surrounding whitespace
    if (inner && !/^\s/.test(inner) && !/\s$/.test(inner)) {
      return { type: 'math', raw: `$${inner}$`, text: `$${inner}$` }
    }
  }
  return undefined
}

/**
 * Keeps math opaque to the markdown parser so that the LateX
 * syntax doesn't get corrupted by it.
 */
export const MarkdownMath = Extension.create({
  name: 'markdownMath',
  markdownTokenName: 'math',

  markdownTokenizer: {
    name: 'math',
    level: 'inline',
    start: '$',
    tokenize: tokenizeMath,
  },

  parseMarkdown(token: { text?: string }) {
    return { type: 'text', text: token.text ?? '' }
  },
})
