/// <reference types="bun-types" />
import { MarkdownListItem } from '@/components/markdown/list-item'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

describe('markdown list rendering', () => {
  test('wraps list item text in paragraphs', () => {
    const html = renderToStaticMarkup(
      <MarkdownListItem>First</MarkdownListItem>,
    )

    expect(html).toBe(
      '<li class="mt-2"><p class="my-0 leading-normal">First</p></li>',
    )
  })
})
