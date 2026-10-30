import type { Element } from 'hast'
import type { ShikiTransformer } from 'shiki'

/** Add a dedicated gutter cell so it can remain sticky while code scrolls. */
export function gutterElement(value?: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      className: ['code-gutter'],
      'aria-hidden': 'true',
      'data-gutter': value,
    },
    children: [],
  }
}

export const gutterTransformer: ShikiTransformer = {
  name: 'line-gutters',
  line(node) {
    node.children.unshift(gutterElement())
  },
}
