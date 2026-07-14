import { Extension, InputRule } from '@tiptap/core'

/** Language tag that marks a block as an executable dynamic block. */
export const DYNAMIC_LANG = 'dynamic'

/** Matches a `$\`\`\`` fenced block at the start of a markdown block. */
const DYNAMIC_FENCE = /^\$```[^\n]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/

/** Opens a dynamic prompt block for `$\`\`\``. */
export const DynamicBlock = Extension.create({
  name: 'dynamicBlock',
  markdownTokenName: 'dynamicBlock',

  markdownTokenizer: {
    name: 'dynamicBlock',
    level: 'block',
    start: '$```',
    tokenize(src: string) {
      const match = DYNAMIC_FENCE.exec(src)
      if (!match) return undefined
      return { type: 'dynamicBlock', raw: match[0], text: match[1] }
    },
  },

  parseMarkdown(token: { text?: string }) {
    return {
      type: 'codeBlock',
      attrs: { language: DYNAMIC_LANG },
      content: token.text ? [{ type: 'text', text: token.text }] : [],
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /\$```$/,
        handler: ({ state, range, chain }) => {
          const hasTextBefore = state.doc.resolve(range.from).parentOffset > 0
          const commands = chain().deleteRange(range)
          if (hasTextBefore) commands.splitBlock()
          commands.setNode('codeBlock', { language: DYNAMIC_LANG }).run()
        },
      }),
    ]
  },
})
