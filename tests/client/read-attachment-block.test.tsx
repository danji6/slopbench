/// <reference types="bun-types" />
import { ReadAttachmentBlock } from '@/components/chat/messages/tools/read-attachment-block'
import type { ToolUIPart } from 'ai'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

describe('read attachment presentation', () => {
  test('shows only offset and limit in a non-expandable row', () => {
    const part = {
      type: 'tool-read_attachment',
      toolCallId: 'read-1',
      state: 'output-available',
      input: {
        url: 'https://app.test/attachments/secret/private.txt',
        offset: 256,
        limit: 4_096,
      },
      output: { kind: 'text', content: 'private contents' },
    } as ToolUIPart

    const html = renderToStaticMarkup(<ReadAttachmentBlock parts={[part]} />)

    expect(html).toContain('Read attachment')
    expect(html).toContain('bytes 256–4351')
    expect(html).not.toContain('secret')
    expect(html).not.toContain('private contents')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Input')
    expect(html).not.toContain('Output')
  })
})
