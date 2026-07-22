/// <reference types="bun-types" />
import { remarkLiteralHtml } from '@/lib/markdown/remark'
import { allowedTags, sanitizeSchema } from '@/lib/markdown/sanitize'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

/** Mirrors the raw-html half of the renderer's plugin chain. */
const render = (markdown: string) =>
  renderToStaticMarkup(
    <Markdown
      remarkPlugins={[[remarkLiteralHtml, { allowed: allowedTags }]]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
    >
      {markdown}
    </Markdown>,
  )

describe('literal html rendering', () => {
  test('keeps unknown inline tags visible', () => {
    expect(render('Use <system-reminder> tags')).toContain(
      '&lt;system-reminder&gt;',
    )
  })

  test('keeps unknown multi-line blocks visible', () => {
    const html = render('<system-reminder>\nbe brief\n</system-reminder>')
    expect(html).toContain('&lt;system-reminder&gt;')
    expect(html).toContain('&lt;/system-reminder&gt;')
    expect(html).toContain('be brief')
  })

  test('still renders allowed html', () => {
    expect(render('a <strong>bold</strong> word')).toContain(
      '<strong>bold</strong>',
    )
  })

  test('leaves code blocks alone', () => {
    expect(render('```\n<system-reminder>\n```')).toContain(
      '&lt;system-reminder&gt;',
    )
  })
})
