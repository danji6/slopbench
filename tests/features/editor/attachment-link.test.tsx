/// <reference types="bun-types" />
import { AttachmentAnchor } from '@/components/markdown/attachment-anchor'
import { attachmentUrlTransform } from '@/lib/markdown/attachment-link'
import { sanitizeSchema } from '@/lib/markdown/sanitize'
import http from '@sb/convex/http'
import { frontendUrl } from '@sb/convex/origins'
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

test('resolves large shared attachments for the browser after validating the reference', async () => {
  const path = '/attachments/token/notes.txt'
  const [action] = http.lookup(path, 'GET')!
  const storageUrl = 'https://storage.example.test/original'
  const ctx = {
    runQuery: async (_query: unknown, { token }: { token: string }) => {
      expect(token).toBe('token')
      return {
        filename: 'notes.txt',
        storageId: 'original',
        byteLength: 2 ** 25,
      }
    },
    storage: {
      getUrl: async (id: string) => {
        expect(id).toBe('original')
        return storageUrl
      },
    },
  }
  // Convex exposes the handler at runtime for dispatch.
  const { _handler: handleRequest } = action as unknown as {
    _handler: (context: typeof ctx, request: Request) => Promise<Response>
  }
  const resolve = (requestPath: string) =>
    handleRequest(
      ctx,
      new Request(`http://localhost:3211${requestPath}?resolve=1`, {
        headers: { Origin: frontendUrl() },
      }),
    )

  const response = await resolve(path)
  expect(response.status).toBe(200)
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
    frontendUrl(),
  )
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ url: storageUrl })
  expect((await resolve('/attachments/token/wrong.txt')).status).toBe(404)
})
