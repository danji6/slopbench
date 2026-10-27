/// <reference types="bun-types" />
import { AttachmentAnchor } from '@/components/markdown/attachment-anchor'
import { attachmentUrlTransform } from '@/lib/markdown/attachment-link'
import { sanitizeSchema } from '@/lib/markdown/sanitize'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'

const render = (content: string) =>
  renderToStaticMarkup(
    <Markdown
      components={{
        a: ({ href, ...props }) =>
          href ? <AttachmentAnchor href={href} {...props} /> : null,
      }}
      rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
      urlTransform={attachmentUrlTransform}
    >
      {content}
    </Markdown>,
  )

describe('attachment markdown links', () => {
  test('renders a host-independent reference as a clickable attachment', () => {
    const html = render('[📎 notes.txt](attachment:token/notes.txt)')

    expect(html).toContain('href="attachment:token/notes.txt"')
    expect(html).toContain('data-attachment-reference=""')
    expect(html).toContain('title="Download notes.txt"')
    expect(html).toContain('📎 notes.txt')
  })

  test('still filters unknown custom protocols', () => {
    const html = render('[unsafe](unknown:value)')

    expect(html).not.toContain('href="unknown:value"')
  })
})
