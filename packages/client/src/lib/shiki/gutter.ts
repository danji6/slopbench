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

/** Separates the gutter from code so both cells share the full line height. */
export function addLineGutter(node: Element, value?: string) {
  node.children = [
    gutterElement(value),
    {
      type: 'element',
      tagName: 'span',
      properties: { className: ['code-content'] },
      children: node.children,
    },
  ]
}

export const gutterTransformer: ShikiTransformer = {
  name: 'line-gutters',
  // Wrap after Shiki applies token decorations in its code hook.
  pre() {
    for (const line of this.lines) addLineGutter(line)
  },
}
