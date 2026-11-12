/// <reference types="bun-types" />
import { ReadAttachmentBlock } from '@/components/chat/messages/tools/read-attachment-block'
import type { ToolUIPart } from 'ai'
import { afterEach, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
})

function renderRead(part: ToolUIPart) {
  const container = document.createElement('div')
  root = createRoot(container)
  act(() =>
    root?.render(<ReadAttachmentBlock messageId="message" parts={[part]} />),
  )
  return container
}

describe('read attachment presentation', () => {
  test('shows the actual historical byte range and expands to the recorded text', () => {
    const part: ToolUIPart = {
      type: 'tool-read_attachment',
      toolCallId: 'read-1',
      state: 'output-available',
      input: {
        url: 'https://app.test/attachments/secret/private.txt',
        offset: 256,
        limit: 65_536,
      },
      output: {
        kind: 'text',
        content: 'private contents\n<script>example</script>',
        offset: 256,
        endOffset: 10_256,
      },
    }

    const container = renderRead(part)
    const trigger = container.querySelector('button')!
    expect(trigger.textContent).toContain('Read attachment')
    expect(trigger.textContent).toContain('bytes 256–10255')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('private contents')

    act(() => trigger.click())

    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('pre > code')?.textContent).toBe(
      'private contents\n<script>example</script>',
    )
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('secret')
  })

  test('reveals the hits from a resumed tail search without exposing the operation ID', () => {
    const part: ToolUIPart = {
      type: 'tool-read_attachment',
      toolCallId: 'search-1',
      state: 'output-available',
      input: { operationId: 'privateOpId1' },
      output: {
        kind: 'search',
        from: 'end',
        operationId: 'privateOpId1',
        matches: [
          { lineFromEnd: 2, preview: 'first hit' },
          { lineFromEnd: 5, preview: 'clipped hit', previewClipped: true },
        ],
      },
    }

    const container = renderRead(part)
    const trigger = container.querySelector('button')!
    expect(trigger.textContent).toContain('Search attachment from end')
    expect(container.querySelector('code')).toBeNull()

    act(() => trigger.click())

    expect(container.querySelector('pre > code')?.textContent).toBe(
      'Line 2 from end  first hit\nLine 5 from end  clipped hit …',
    )
    expect(container.innerHTML).not.toContain('privateOpId1')
  })

  test('keeps a media result without text non-expandable', () => {
    const part: ToolUIPart = {
      type: 'tool-read_attachment',
      toolCallId: 'read-media',
      state: 'output-available',
      input: { reference: 'attachment:token/photo.png' },
      output: { kind: 'media', url: 'https://storage.test/private' },
    }
    const html = renderToStaticMarkup(
      <ReadAttachmentBlock messageId="message" parts={[part]} />,
    )

    expect(html).toContain('Read attachment')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('storage.test')
  })
})
