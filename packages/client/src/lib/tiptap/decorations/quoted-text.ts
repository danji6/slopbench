import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const key = new PluginKey<DecorationSet>('quotedText')

export const QuotedTextDecoration = Extension.create({
  name: 'quotedTextDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init(_, { doc }) {
            return build(doc)
          },
          apply(tr, old) {
            return tr.docChanged ? build(tr.doc) : old
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)
          },
        },
      }),
    ]
  },
})

function build(doc: Node): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (!node.isBlock || !node.inlineContent) return

    const straightPositions: number[] = []
    const curlyOpenPositions: number[] = []

    node.descendants((child, childPos) => {
      if (!child.isText || !child.text) return
      for (let i = 0; i < child.text.length; i++) {
        const ch = child.text[i]
        const absPos = pos + 1 + childPos + i
        if (ch === '"') {
          straightPositions.push(absPos)
        } else if (ch === '“') {
          curlyOpenPositions.push(absPos)
        } else if (ch === '”') {
          if (curlyOpenPositions.length > 0) {
            decorations.push(
              Decoration.inline(curlyOpenPositions.shift()!, absPos + 1, {
                class: 'quoted',
              }),
            )
          }
        }
      }
    })

    for (let i = 0; i + 1 < straightPositions.length; i += 2) {
      decorations.push(
        Decoration.inline(straightPositions[i], straightPositions[i + 1] + 1, {
          class: 'quoted',
        }),
      )
    }
  })

  return DecorationSet.create(doc, decorations)
}
