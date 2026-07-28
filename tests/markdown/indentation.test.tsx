/// <reference types="bun-types" />
import { remarkPreserveIndent } from '@/lib/markdown/remark'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'

/** Mirrors the renderer, whose chat messages render soft breaks as breaks. */
const render = (markdown: string, softBreaks = true) =>
  renderToStaticMarkup(
    <Markdown
      remarkPlugins={[
        [remarkPreserveIndent, { softBreaks }],
        ...(softBreaks ? [remarkBreaks] : []),
      ]}
    >
      {markdown}
    </Markdown>,
  )

const indent = (spaces: number) =>
  `<span class="md-indent">${' '.repeat(spaces)}</span>`

describe('preserved indentation', () => {
  test('restores the indent of a continuation line', () => {
    expect(render('test\n  test')).toContain(`${indent(2)}test`)
  })

  test('restores the indent after a hard break', () => {
    expect(render('test  \n  test')).toContain(`${indent(2)}test`)
  })

  test('restores every line of an indented run', () => {
    const html = render('a\n  b\n    c')
    expect(html).toContain(`${indent(2)}b`)
    expect(html).toContain(`${indent(4)}c`)
  })

  test('leaves unindented text alone', () => {
    expect(render('test\ntest')).not.toContain('md-indent')
  })

  test('leaves soft breaks alone when they flow into one line', () => {
    expect(render('test\n  test', false)).not.toContain('md-indent')
  })

  test('measures from the indentation the block already carries', () => {
    // The list item's own two columns are the baseline, not extra indentation
    expect(render('- a\n  b')).not.toContain('md-indent')
    expect(render('- a\n    b')).toContain(indent(2))
  })

  test('reaches text nested in inline markup', () => {
    expect(render('**a\n  b**')).toContain(`${indent(2)}b`)
  })
})
