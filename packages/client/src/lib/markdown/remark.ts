/* eslint-disable @typescript-eslint/no-explicit-any */
import { findMentions } from '@sb/core/mentions/parse'
import type { Components } from 'react-markdown'
import { SKIP, visit } from 'unist-util-visit'

export type MarkdownComponents = Omit<Components, 'group'> & {
  'md-group'?: React.ComponentType<{
    items?: string
    type: 'code' | 'media'
    direction?: 'row' | 'col'
    children?: React.ReactNode
  }>
  'md-meta'?: React.ComponentType<{ content: string }>
  'md-quoted'?: React.ComponentType<{ children?: React.ReactNode }>
  'md-mention'?: React.ComponentType<{
    path?: string
    children?: React.ReactNode
  }>
  'md-streaming-cursor'?: React.ComponentType
}

/**
 * Splits images into separate elements rather than nesting them in a paragraph.
 * The only exception is for floating images, which are distinguished by a
 * `floating` attribute in the alt text. @see {@link isFloating}
 */
export function remarkSplitImages() {
  return (tree: any) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      const hasImage = node.children.some(
        (child: any) => child.type === 'image',
      )
      if (!hasImage) return

      const newNodes: any[] = []
      let currentTextBuffer: any[] = []

      for (const child of node.children) {
        if (child.type === 'image') {
          if (isFloating(child)) {
            currentTextBuffer.push(child)
          } else {
            if (currentTextBuffer.length > 0) {
              newNodes.push({ type: 'paragraph', children: currentTextBuffer })
              currentTextBuffer = []
            }
            newNodes.push(child)
          }
        } else {
          currentTextBuffer.push(child)
        }
      }

      if (currentTextBuffer.length > 0) {
        newNodes.push({ type: 'paragraph', children: currentTextBuffer })
      }

      parent.children.splice(index, 1, ...newNodes)
      return (index || 0) + newNodes.length
    })
  }
}

/**
 * Parses content after ```
 */
export function remarkCodeMeta() {
  return (tree: any) => {
    visit(tree, 'code', (node) => {
      if (node.meta) {
        node.data = node.data || {}
        node.data.hProperties = node.data.hProperties || {}
        node.data.hProperties.title = node.meta
      }

      const language = node.lang
      if (language) {
        node.data = node.data || {}
        node.data.hProperties = node.data.hProperties || {}
        node.data.hProperties.language = language
      }
    })
  }
}

/**
 * Promotes a `$$..$$` that is the sole content of its paragraph to centered
 * display math.
 */
export function remarkPromoteDisplayMath() {
  return (tree: any, file: any) => {
    const source = String(file.value)
    visit(tree, 'paragraph', (node: any) => {
      const meaningful = node.children.filter(
        (c: any) => !(c.type === 'text' && !c.value.trim()),
      )
      if (meaningful.length !== 1) return
      const child = meaningful[0]
      if (child.type !== 'inlineMath') return

      const start = child.position?.start?.offset
      if (start == null || source.slice(start, start + 2) !== '$$') return

      child.data = child.data || {}
      child.data.hName = 'code'
      child.data.hProperties = {
        ...(child.data.hProperties || {}),
        className: ['language-math', 'math-display'],
      }
    })
  }
}

/**
 * Groups consecutive media/code nodes into custom `md-group` nodes.
 * Hidden media is excluded from the group and moved to the end.
 */
export function remarkGroup() {
  return (tree: any) => {
    visit(tree, (node, index, parent) => {
      if (!parent || index === null || index === undefined) return
      const children = parent.children

      if (node.type === 'code') {
        const start = index
        let end = index
        while (end + 1 < children.length && children[end + 1].type === 'code') {
          end++
        }

        const codeNodes = children.slice(start, end + 1)
        const items = codeNodes.map((c: any) => ({
          lang: c.lang,
          value: c.value,
          title: c.meta || c.desc || '',
        }))

        parent.children.splice(start, codeNodes.length, {
          type: 'mdGroup',
          data: {
            hName: 'md-group',
            hProperties: {
              type: 'code',
              items: JSON.stringify(items),
            },
          },
        })
        return start + 1
      }

      const meta = parseMetadata(node)
      if (meta) {
        const imageNodes: any[] = []
        for (let i = index + 1; i < children.length; i++) {
          const child = children[i]
          if (child.type === 'image') {
            imageNodes.push(child)
          } else if (child.type === 'break') {
            continue
          } else {
            break
          }
        }

        if (imageNodes.length > 0) {
          parent.children.splice(index, imageNodes.length, {
            type: 'mdGroup',
            data: {
              hName: 'md-group',
              hProperties: {
                type: 'media',
                direction: meta,
              },
            },
            children: imageNodes,
          })
          return index + 1
        }
      }

      if (isMedia(node)) {
        let mediaEnd = index
        while (true) {
          const nextIdx = mediaEnd + 1
          if (nextIdx >= children.length) break
          const next = children[nextIdx]
          if (next.type === 'break') {
            const afterBreak = children[nextIdx + 1]
            if (afterBreak && isMedia(afterBreak)) {
              mediaEnd = nextIdx + 1
              continue
            }
          }
          if (isMedia(next)) {
            mediaEnd = nextIdx
            continue
          }
          break
        }

        const nodes = children.slice(index, mediaEnd + 1)
        const visibleImages: any[] = []
        const hiddenImages: any[] = []

        for (const n of nodes) {
          if (n.type === 'image') {
            if (isHidden(n)) hiddenImages.push(n)
            else visibleImages.push(n)
          } else if (n.type === 'paragraph') {
            for (const c of n.children) {
              if (c.type === 'image') {
                if (isHidden(c)) hiddenImages.push(c)
                else visibleImages.push(c)
              }
            }
          }
        }

        const newNodes: any[] = []
        if (visibleImages.length > 0) {
          newNodes.push({
            type: 'mdGroup',
            data: {
              hName: 'md-group',
              hProperties: {
                type: 'media',
                direction: 'col',
              },
            },
            children: visibleImages,
          })
        }

        newNodes.push(...hiddenImages)

        if (newNodes.length === 0) {
          parent.children.splice(index, mediaEnd - index + 1)
          return index
        }

        parent.children.splice(index, mediaEnd - index + 1, ...newNodes)
        return index + newNodes.length
      }
    })
  }
}

/** Parses :::meta content into a custom `md-meta` node */
export function remarkMeta() {
  function createMetaNode(content: string) {
    return {
      type: 'mdMeta',
      data: {
        hName: 'md-meta',
        hProperties: { content },
      },
    }
  }

  return (tree: any) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || index === null || index === undefined) return
      const children = node.children

      const fullText = children.map((c: any) => c.value || '').join('')
      const trimmedText = fullText.trimStart()

      if (!trimmedText.startsWith(':::')) return

      const newlineIndex = fullText.indexOf('\n')

      if (newlineIndex !== -1) {
        const metaLine = fullText.slice(0, newlineIndex)
        const content = metaLine.trimStart().slice(3).trim()
        const metaNode = createMetaNode(content)
        const newChildren = splitNodes(children, newlineIndex, 1)

        if (newChildren.length > 0) {
          parent.children.splice(index, 1, metaNode, {
            type: 'paragraph',
            children: newChildren,
          })
          return index + 2
        }

        parent.children.splice(index, 1, metaNode)
        return index + 1
      }

      const content = trimmedText.slice(3).trim()
      parent.children.splice(index, 1, createMetaNode(content))
      return index + 1
    })
  }
}

const quoteNodeTypes = new Set([
  'paragraph',
  'heading',
  'emphasis',
  'strong',
  'link',
  'listItem',
  'blockquote',
])

/** Highlights double-quoted text by wrapping it in a custom `md-quoted` node. */
export function remarkHighlightQuotes() {
  return (tree: any) => {
    visit(tree, (node: any, _index: number | undefined, parent: any) => {
      if (parent?.type === 'md-quoted') return
      if (!node.children || node.children.length === 0) return
      if (!quoteNodeTypes.has(node.type)) return

      // Split every text node at quote boundaries (straight and curly)
      const splitChildren: any[] = []
      for (const child of node.children) {
        if (child.type !== 'text') {
          splitChildren.push(child)
          continue
        }

        const text = child.value
        let lastIdx = 0
        for (let i = 0; i < text.length; i++) {
          const ch = text[i]
          if (ch === '\u0022' || ch === '\u201C' || ch === '\u201D') {
            if (i > lastIdx) {
              splitChildren.push({
                type: 'text',
                value: text.slice(lastIdx, i),
              })
            }
            splitChildren.push({ type: 'text', value: ch })
            lastIdx = i + 1
          }
        }
        if (lastIdx < text.length) {
          splitChildren.push({ type: 'text', value: text.slice(lastIdx) })
        }
      }

      // Pair quote marks: straight quotes greedily, curly quotes directionally
      const pairs: [number, number][] = []
      const pendingStraight: number[] = []
      const pendingCurlyOpen: number[] = []

      for (let i = 0; i < splitChildren.length; i++) {
        const child = splitChildren[i]
        if (child.type !== 'text') continue
        const v = child.value
        if (v === '\u0022') {
          if (pendingStraight.length > 0) {
            pairs.push([pendingStraight.shift()!, i])
          } else {
            pendingStraight.push(i)
          }
        } else if (v === '“') {
          pendingCurlyOpen.push(i)
        } else if (v === '”') {
          if (pendingCurlyOpen.length > 0) {
            pairs.push([pendingCurlyOpen.shift()!, i])
          }
        }
      }

      if (pairs.length === 0) return
      pairs.sort((a, b) => a[0] - b[0])

      // Wrap paired ranges in md-quoted nodes
      const newChildren: any[] = []
      let childIdx = 0

      for (const [openIdx, closeIdx] of pairs) {
        while (childIdx < openIdx) {
          newChildren.push(splitChildren[childIdx++])
        }

        const quotedChildren: any[] = []
        for (let i = openIdx + 1; i < closeIdx; i++) {
          quotedChildren.push(splitChildren[i])
        }

        newChildren.push({
          type: 'md-quoted',
          children: [
            { type: 'text', value: splitChildren[openIdx].value },
            ...quotedChildren,
            { type: 'text', value: splitChildren[closeIdx].value },
          ],
          data: { hName: 'md-quoted' },
        })

        childIdx = closeIdx + 1
      }

      while (childIdx < splitChildren.length) {
        newChildren.push(splitChildren[childIdx++])
      }

      node.children = newChildren
    })
  }
}

/** Wraps `@path` / `@"spaced path"` file mentions in a `md-mention` node. */
export function remarkMention() {
  return (tree: any) => {
    visit(tree, 'text', (node: any, index, parent: any) => {
      if (index == null || !parent || parent.type === 'md-mention') return
      const matches = findMentions(node.value)
      if (matches.length === 0) return

      const children: any[] = []
      let last = 0
      for (const match of matches) {
        if (match.start > last) {
          children.push({
            type: 'text',
            value: node.value.slice(last, match.start),
          })
        }
        children.push({
          type: 'md-mention',
          data: { hName: 'md-mention', hProperties: { path: match.path } },
          children: [
            { type: 'text', value: node.value.slice(match.start, match.end) },
          ],
        })
        last = match.end
      }
      if (last < node.value.length) {
        children.push({ type: 'text', value: node.value.slice(last) })
      }

      parent.children.splice(index, 1, ...children)
      return [SKIP, index + children.length]
    })
  }
}

/** Places a streaming cursor at the final rendered markdown leaf. */
export function remarkStreamingCursor() {
  return (tree: any) => {
    placeStreamingCursor(tree)
  }
}

const inlineCursorContainers = new Set([
  'delete',
  'emphasis',
  'heading',
  'link',
  'linkReference',
  'md-mention',
  'md-quoted',
  'paragraph',
  'strong',
  'tableCell',
])

function placeStreamingCursor(node: any): boolean {
  if (node.type === 'code') {
    node.data = node.data || {}
    node.data.hProperties = node.data.hProperties || {}
    node.data.hProperties.dataStreamingCursor = 'true'
    return true
  }

  if (!Array.isArray(node.children)) return false

  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i]
    if (isEmptyText(child)) continue
    if (placeStreamingCursor(child)) return true

    if (inlineCursorContainers.has(node.type)) {
      node.children.splice(i + 1, 0, createStreamingCursorNode())
      return true
    }
  }

  if (inlineCursorContainers.has(node.type)) {
    node.children.push(createStreamingCursorNode())
    return true
  }

  return false
}

function createStreamingCursorNode() {
  return {
    type: 'md-streaming-cursor',
    data: { hName: 'md-streaming-cursor' },
  }
}

function isEmptyText(node: any) {
  return node.type === 'text' && node.value.trim() === ''
}

/**
 * Autocompletes unclosed emphasis in the last paragraph, for use during
 * streaming.
 */
export function remarkAutoCloseEmphasis() {
  return (tree: any) => {
    const blocks = tree.children
    if (blocks.length === 0) return

    const lastBlock = blocks[blocks.length - 1]
    if (lastBlock.type !== 'paragraph') return

    const children = lastBlock.children
    const lastChild = children[children.length - 1]
    if (!lastChild || lastChild.type !== 'text') return

    const text: string = lastChild.value
    const openerIndex = findEmphasisOpener(text)
    if (openerIndex === -1) return

    const before = text.slice(0, openerIndex)
    const content = text.slice(openerIndex + 1)

    const emphasisNode = {
      type: 'emphasis',
      children: [{ type: 'text', value: content }],
    }

    children.splice(
      children.length - 1,
      1,
      ...(before
        ? [{ type: 'text', value: before }, emphasisNode]
        : [emphasisNode]),
    )
  }
}

function findEmphasisOpener(text: string): number {
  for (let i = text.length - 2; i >= 0; i--) {
    if (text[i] !== '*') continue
    if (text[i - 1] === '*' || text[i + 1] === '*') continue
    if (/\s/.test(text[i + 1])) continue
    return i
  }
  return -1
}

function isFloating(n: any) {
  return n.alt && /{[^}]*\b(left|right)\b[^}]*}/.test(n.alt)
}

function isHidden(n: any) {
  return n.alt && /{[^}]*\bhidden\b[^}]*}/.test(n.alt)
}

function isMedia(n: any) {
  if (n.type === 'image') {
    // Note: videos also use image tags in markdown
    return !isFloating(n)
  }

  if (n.type === 'paragraph') {
    const hasOnlyImages = n.children.every(
      (c: any) => c.type === 'image' || (c.type === 'text' && !c.value.trim()),
    )

    if (!hasOnlyImages) return false

    const hasFloatingImage = n.children.some((c: any) => {
      return c.type === 'image' && isFloating(c)
    })

    return !hasFloatingImage
  }

  return false
}

function parseMetadata(n: any) {
  if (n.type !== 'paragraph') return null
  const text = n.children
    .map((c: any) => c.value || '')
    .join('')
    .trim()
  const match = text.match(/^:::\s*(row|col)$/)
  return match ? match[1] : null
}

function splitNodes(children: any[], splitIndex: number, skip = 0) {
  let charCount = 0
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const childValue = child.value || ''

    if (charCount + childValue.length > splitIndex) {
      const offset = splitIndex - charCount
      const remainingValue = childValue.slice(offset + skip)

      const newNodes = []
      if (remainingValue) {
        newNodes.push({ ...child, value: remainingValue })
      }
      newNodes.push(...children.slice(i + 1))
      return newNodes
    }
    charCount += childValue.length
  }
  return []
}
