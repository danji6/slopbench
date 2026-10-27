/// <reference types="bun-types" />
import { remarkLiteralHtml } from '@/lib/markdown/remark'
import { sanitizeSchema } from '@/lib/markdown/sanitize'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'

/** Mirrors the raw-html half of the renderer's plugin chain. */
const render = (markdown: string) =>
  renderToStaticMarkup(
    <Markdown
      remarkPlugins={[remarkLiteralHtml]}
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

  test('keeps the indentation of a literal block', () => {
    const html = render('<system-reminder>\n  be brief\n</system-reminder>')
    expect(html).toContain('class="md-literal-html"')
    expect(html).toContain('\n  be brief\n')
  })

  test('renders an element whose only unknown tags are nested', () => {
    const html = render('<div style="color:red">\n<label>x</label>\n</div>')
    expect(html).toContain('<div style="color:red">')
    expect(html).toContain('<label>x</label>')
  })

  test('still hides an unknown tag beside an allowed one', () => {
    expect(
      render('<div>a</div>\n<system-reminder>b</system-reminder>'),
    ).toContain('&lt;system-reminder&gt;')
  })

  test('keeps an unknown tag nested inside an allowed element visible', () => {
    const html = render('<div><system-reminder>hi</system-reminder></div>')
    expect(html).toContain('<div>')
    expect(html).toContain('&lt;system-reminder&gt;hi&lt;/system-reminder&gt;')
  })

  test('keeps text that only looks like a tag', () => {
    expect(render('<div>Array<number> generic</div>')).toContain(
      'Array&lt;number&gt; generic',
    )
  })

  test('escapes nested markup instead of executing it', () => {
    const html = render('<div><script>alert(1)</script></div>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('renders html wrapped around markdown', () => {
    const html = render('<div class="wrap">\n\n**bold**\n\n</div>')
    expect(html).toContain('<div class="wrap">')
    expect(html).toContain('<strong>bold</strong>')
  })
})
