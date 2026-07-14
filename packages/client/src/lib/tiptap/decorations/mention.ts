import { findMentions } from '@sb/core/mentions/parse'
import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const mentionKey = new PluginKey<DecorationSet>('mention')

export const MentionDecoration = Extension.create({
  name: 'mentionDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mentionKey,
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
            return mentionKey.getState(state)
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

    node.descendants((child, childPos) => {
      if (!child.isText || !child.text) return
      const base = pos + 1 + childPos
      for (const match of findMentions(child.text)) {
        decorations.push(
          Decoration.inline(base + match.start, base + match.end, {
            class: 'mention',
          }),
        )
      }
    })
  })

  return DecorationSet.create(doc, decorations)
}
