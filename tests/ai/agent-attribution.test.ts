/// <reference types="bun-types" />
import type { Doc } from '@sb/convex/_generated/dataModel'
import {
  buildProviderHistory,
  prefixSenderName,
  removeOrphanToolCalls,
  representMessage,
} from '@sb/convex/actions/stream/history'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

const SELF = 'agent_self' as Doc<'agents'>['_id']
const OTHER = 'agent_other' as Doc<'agents'>['_id']
const USER = 'user_1' as Doc<'users'>['_id']

function agent(contextOptions: Partial<Doc<'agents'>> = {}): Doc<'agents'> {
  return {
    _id: SELF,
    trimContext: false,
    contextWindow: -1,
    outputTokens: -1,
    shareUserDisplayNames: false,
    shareAgentDisplayNames: false,
    maskOtherAgents: false,
    ...contextOptions,
  } as Doc<'agents'>
}

function stored(
  sender: Doc<'messages'>['sender'],
  role: Doc<'messages'>['role'],
  name: string,
): Doc<'messages'> {
  return { sender, role, senderSnapshot: { name } } as Doc<'messages'>
}

function providerData() {
  return {
    stream: { _id: 'stream_1' },
    session: {},
    agent: agent(),
    settings: {},
  } as never
}

function providerDataWithWorkspace() {
  return {
    stream: { _id: 'stream_1' },
    session: {
      _id: 'session_1',
      workspace: { workspaceId: 'ws_1', label: 'ws' },
    },
    agent: agent(),
    settings: {},
  } as never
}

/** Run `fn` with `globalThis.fetch` replaced (used to stub the sidecar). */
async function withFetch<T>(
  handler: (input: unknown) => Response | Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = handler as never
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function userMessage(parts: unknown[]): Doc<'messages'> {
  return {
    _id: 'message_1',
    role: 'user',
    sender: { type: 'user', id: USER },
    senderSnapshot: { name: 'Alice' },
    parts,
  } as unknown as Doc<'messages'>
}

function attachmentHistoryCtx({
  message,
  attachment,
  blobs,
}: {
  message: Doc<'messages'>
  attachment: {
    storageId: string
    previewStorageId?: string
    mediaType: string
    filename: string
  }
  blobs: Record<string, Blob>
}) {
  return {
    runQuery: async (_query: unknown, args: Record<string, unknown>) => {
      if ('streamId' in args) return [message]
      if ('attachmentId' in args) return attachment
      return null
    },
    storage: {
      get: async (id: string) => blobs[id] ?? null,
    },
  } as never
}

function attachmentMessage(
  attachmentId: string,
  mediaType: string,
  filename: string,
) {
  return userMessage([
    {
      type: 'file',
      url: `attachment:${attachmentId}`,
      attachmentId,
      mediaType,
      filename,
    },
  ])
}

function firstContentPart(
  history: Awaited<ReturnType<typeof buildProviderHistory>>,
) {
  const first = history[0]
  if (!first || typeof first.content === 'string') return null
  return first.content[0] ?? null
}

const textAndToolParts: UIMessage['parts'] = [
  { type: 'reasoning', text: 'thinking' },
  { type: 'text', text: 'hello' },
  {
    type: 'tool-web_fetch',
    toolCallId: 't1',
    state: 'output-available',
  } as never,
]

describe('representMessage', () => {
  test('keeps own assistant turn untouched', () => {
    const msg = stored({ type: 'agent', id: SELF }, 'assistant', 'Self')
    const result = representMessage(msg, agent({ maskOtherAgents: true }), [
      ...textAndToolParts,
    ])
    expect(result.role).toBe('assistant')
    expect(result.parts).toHaveLength(3)
  })

  test('masks other agent as a user turn and strips non-text/file parts', () => {
    const msg = stored({ type: 'agent', id: OTHER }, 'assistant', 'Other')
    const result = representMessage(msg, agent({ maskOtherAgents: true }), [
      ...textAndToolParts,
    ])
    expect(result.role).toBe('user')
    expect(result.parts).toEqual([{ type: 'text', text: 'hello' }])
  })

  test('leaves other agent as assistant when masking is off', () => {
    const msg = stored({ type: 'agent', id: OTHER }, 'assistant', 'Other')
    const result = representMessage(msg, agent({ maskOtherAgents: false }), [
      ...textAndToolParts,
    ])
    expect(result.role).toBe('assistant')
    expect(result.parts).toHaveLength(3)
  })

  test('user turns keep their role but drop non-text/file parts', () => {
    const msg = stored({ type: 'user', id: USER }, 'user', 'Alice')
    const result = representMessage(msg, agent({ maskOtherAgents: true }), [
      ...textAndToolParts,
    ])
    expect(result.role).toBe('user')
    expect(result.parts).toEqual([{ type: 'text', text: 'hello' }])
  })
})

describe('prefixSenderName', () => {
  const message = (): UIMessage => ({
    id: 'm1',
    role: 'user',
    parts: [{ type: 'text', text: 'hi' }],
  })

  function textOf(parts: UIMessage['parts']) {
    const part = parts.find((p) => p.type === 'text')
    return part && part.type === 'text' ? part.text : undefined
  }

  test('prefixes user name only when shareUserDisplayNames is on', () => {
    const msg = stored({ type: 'user', id: USER }, 'user', 'Alice')
    expect(textOf(prefixSenderName(message(), msg, agent()))).toBe('hi')
    expect(
      textOf(
        prefixSenderName(
          message(),
          msg,
          agent({ shareUserDisplayNames: true }),
        ),
      ),
    ).toBe('Alice: hi')
  })

  test('prefixes other agent name only when shareAgentDisplayNames is on', () => {
    const msg = stored({ type: 'agent', id: OTHER }, 'assistant', 'Bot')
    expect(textOf(prefixSenderName(message(), msg, agent()))).toBe('hi')
    expect(
      textOf(
        prefixSenderName(
          message(),
          msg,
          agent({ shareAgentDisplayNames: true }),
        ),
      ),
    ).toBe('Bot: hi')
  })

  test('never prefixes the agent itself', () => {
    const msg = stored({ type: 'agent', id: SELF }, 'assistant', 'Self')
    expect(
      textOf(
        prefixSenderName(
          message(),
          msg,
          agent({ shareAgentDisplayNames: true }),
        ),
      ),
    ).toBe('hi')
  })
})

describe('buildProviderHistory', () => {
  test('uses embedded file link snapshots for provider history', async () => {
    const message = userMessage([
      {
        type: 'file-link',
        path: 'src/a.ts',
        snapshot: {
          kind: 'text',
          path: 'src/a.ts',
          content: 'const x = 1',
          truncated: false,
        },
      },
      { type: 'text', text: 'explain @src/a.ts' },
    ])
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<file path="src/a.ts">\nconst x = 1\n</file>',
          },
          { type: 'text', text: 'explain @src/a.ts' },
        ],
      },
    ])
  })

  test('marks snapshotless file links unavailable when no workspace is bound', async () => {
    const message = userMessage([
      { type: 'file-link', path: 'src/a.ts' },
      { type: 'text', text: 'explain @src/a.ts' },
    ])
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              '<file path="src/a.ts" status="unavailable">\n' +
              'This file is no longer available.\n' +
              '</file>',
          },
          { type: 'text', text: 'explain @src/a.ts' },
        ],
      },
    ])
  })

  test('uses an embedded snapshot without reading the workspace', async () => {
    const message = userMessage([
      {
        type: 'file-link',
        path: 'src/a.ts',
        snapshot: {
          kind: 'text',
          path: 'src/a.ts',
          content: 'const x = 1',
          truncated: false,
        },
      },
    ])
    const ctx = { runQuery: async () => [message] } as never

    const history = await withFetch(
      () => {
        throw new Error('snapshot should short-circuit the sidecar read')
      },
      () => buildProviderHistory(ctx, providerDataWithWorkspace(), []),
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<file path="src/a.ts">\nconst x = 1\n</file>',
          },
        ],
      },
    ])
  })

  test('lazily resolves snapshotless binary links from the workspace', async () => {
    const message = userMessage([
      { type: 'file-link', path: 'logo.png' },
      { type: 'text', text: 'describe @logo.png' },
    ])
    const ctx = { runQuery: async () => [message] } as never

    const history = await withFetch(
      () =>
        jsonResponse({
          kind: 'binary',
          path: 'logo.png',
          base64: 'AQID',
          mediaType: 'image/png',
          filename: 'logo.png',
        }),
      () => buildProviderHistory(ctx, providerDataWithWorkspace(), []),
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'logo.png',
            data: { type: 'url', url: new URL('data:image/png;base64,AQID') },
          },
          { type: 'text', text: 'describe @logo.png' },
        ],
      },
    ])
  })

  /**
   * Dropping the part would shift every byte after it, retroactively rewriting
   * history for the rest of the session; the placeholder keeps the prefix.
   */
  test('replaces links that no longer resolve with a fixed placeholder', async () => {
    const message = userMessage([
      { type: 'file-link', path: 'gone.txt' },
      { type: 'text', text: 'explain @gone.txt' },
    ])
    const ctx = { runQuery: async () => [message] } as never

    const history = await withFetch(
      () => new Response('not found', { status: 500 }),
      () => buildProviderHistory(ctx, providerDataWithWorkspace(), []),
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              '<file path="gone.txt" status="unavailable">\n' +
              'This file is no longer available.\n' +
              '</file>',
          },
          { type: 'text', text: 'explain @gone.txt' },
        ],
      },
    ])
  })

  test('renders an over-cap binary link as a skip marker', async () => {
    const message = userMessage([
      {
        type: 'file-link',
        path: 'huge.bin',
        snapshot: {
          kind: 'skipped',
          path: 'huge.bin',
          reason: 'larger than 2000000 bytes',
        },
      },
    ])
    const ctx = { runQuery: async () => [message] } as never

    const history = await withFetch(
      () => {
        throw new Error('a skipped link must not read the workspace')
      },
      () => buildProviderHistory(ctx, providerDataWithWorkspace(), []),
    )

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              '<file path="huge.bin" status="skipped">\n' +
              'Not included: larger than 2000000 bytes.\n' +
              '</file>',
          },
        ],
      },
    ])
  })

  test('embeds text/plain attachments as file blocks', async () => {
    const message = attachmentMessage('att_text', 'text/plain', 'notes.txt')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_text',
        mediaType: 'text/plain',
        filename: 'notes.txt',
      },
      blobs: { blob_text: new Blob(['hello\nworld']) },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<file path="notes.txt">\nhello\nworld\n</file>',
          },
        ],
      },
    ])
  })

  for (const mediaType of ['', 'application/octet-stream']) {
    test(`embeds text-looking attachments with ${mediaType || 'empty'} media type`, async () => {
      const message = attachmentMessage('att_md', mediaType, 'README.md')
      const ctx = attachmentHistoryCtx({
        message,
        attachment: {
          storageId: 'blob_md',
          mediaType,
          filename: 'README.md',
        },
        blobs: { blob_md: new Blob(['# Project']) },
      })

      const history = await buildProviderHistory(ctx, providerData(), [])

      expect(history).toEqual([
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<file path="README.md">\n# Project\n</file>',
            },
          ],
        },
      ])
    })
  }

  test('keeps image attachments as file data urls', async () => {
    const message = attachmentMessage('att_png', 'image/png', 'pixel.png')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_png',
        previewStorageId: 'blob_preview',
        mediaType: 'image/png',
        filename: 'pixel.png',
      },
      blobs: {
        blob_png: new Blob([new Uint8Array([9, 9, 9])]),
        blob_preview: new Blob([new Uint8Array([1, 2, 3])]),
      },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'image/png',
            filename: 'pixel.png',
            data: { type: 'url', url: new URL('data:image/png;base64,AQID') },
          },
        ],
      },
    ])
  })

  test('keeps binary attachments as file data urls', async () => {
    const message = attachmentMessage('att_pdf', 'application/pdf', 'doc.pdf')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_pdf',
        mediaType: 'application/pdf',
        filename: 'doc.pdf',
      },
      blobs: { blob_pdf: new Blob([new Uint8Array([37, 80, 68, 70])]) },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'file',
            mediaType: 'application/pdf',
            filename: 'doc.pdf',
            data: {
              type: 'url',
              url: new URL('data:application/pdf;base64,JVBERg=='),
            },
          },
        ],
      },
    ])
  })

  test('escapes attachment filenames in file block paths', async () => {
    const filename = 'bad"\n<name>.txt'
    const message = attachmentMessage('att_escape', 'text/plain', filename)
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_escape',
        mediaType: 'text/plain',
        filename,
      },
      blobs: { blob_escape: new Blob(['content']) },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])

    expect(history).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<file path="bad&quot; &lt;name&gt;.txt">\ncontent\n</file>',
          },
        ],
      },
    ])
  })

  test('truncates large text attachments in file blocks', async () => {
    const message = attachmentMessage('att_long', 'text/plain', 'long.txt')
    const ctx = attachmentHistoryCtx({
      message,
      attachment: {
        storageId: 'blob_long',
        mediaType: 'text/plain',
        filename: 'long.txt',
      },
      blobs: { blob_long: new Blob(['x'.repeat(50_001)]) },
    })

    const history = await buildProviderHistory(ctx, providerData(), [])
    const part = firstContentPart(history)

    expect(part?.type).toBe('text')
    expect(
      part?.type === 'text' &&
        part.text.startsWith(`<file path="long.txt">\n${'x'.repeat(50_000)}`),
    ).toBe(true)
    expect(
      part?.type === 'text' && part.text.endsWith('\n[truncated]\n</file>'),
    ).toBe(true)
  })

  test('keeps completed tool outputs in provider history', async () => {
    const data = {
      stream: { _id: 'stream_1' },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderSnapshot: { name: 'Assistant' },
      parts: [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool-shell',
          toolCallId: 'functions.shell:1',
          state: 'output-available',
          input: { command: 'pwd' },
          output: '/home/null/Projects/chat',
        },
      ],
    }
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await buildProviderHistory(ctx, data, [])

    expect(history).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool-call',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
            input: { command: 'pwd' },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
            output: { type: 'text', value: '/home/null/Projects/chat' },
          },
        ],
      },
    ])
  })

  test('drops incomplete tool calls from the current processing message', async () => {
    const data = {
      stream: { _id: 'stream_1' },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderSnapshot: { name: 'Assistant' },
      parts: [
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool-shell',
          toolCallId: 'functions.shell:1',
          state: 'input-available',
          input: { command: 'pwd' },
        },
      ],
    }
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await buildProviderHistory(ctx, data, [])

    expect(history).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Let me check.' }],
      },
    ])
  })

  test('surfaces an unanswered approval-request as a denied result', async () => {
    // Left as a bare tool-call the AI SDK would drop it, blinding the model
    // and driving a retry loop (notably auto-denied sub-agent calls). It must
    // reach the model as a denied tool-result instead.
    const data = {
      stream: { _id: 'stream_1' },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderSnapshot: { name: 'Assistant' },
      parts: [
        { type: 'text', text: 'I need approval.' },
        {
          type: 'tool-shell',
          toolCallId: 'functions.shell:1',
          state: 'approval-requested',
          input: { command: 'pwd' },
          approval: { id: 'approval_1' },
        },
      ],
    }
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await buildProviderHistory(ctx, data, [])

    const toolMessage = history.find((m) => m.role === 'tool')
    const toolResult = (
      toolMessage?.content as { type: string; output?: unknown }[] | undefined
    )?.find((p) => p.type === 'tool-result') as
      { output: { type: string; value: string } } | undefined

    expect(history[0]).toMatchObject({ role: 'assistant' })
    expect(toolResult?.output.type).toBe('error-text')
    expect(toolResult?.output.value).toContain('denied')
  })

  test('keeps approved tool calls so they can execute', async () => {
    const data = {
      stream: { _id: 'stream_1' },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderSnapshot: { name: 'Assistant' },
      parts: [
        { type: 'text', text: 'Running shell.' },
        {
          type: 'tool-shell',
          toolCallId: 'functions.shell:1',
          state: 'approval-responded',
          input: { command: 'pwd' },
          approval: { id: 'approval_1', approved: true },
        },
      ],
    }
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await buildProviderHistory(ctx, data, [])

    expect(history).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running shell.' },
          {
            type: 'tool-call',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
            input: { command: 'pwd' },
            providerExecuted: undefined,
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval_1',
            toolCallId: 'functions.shell:1',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: true,
            reason: undefined,
            providerExecuted: undefined,
          },
        ],
      },
    ])
  })

  test('keeps denied tool calls as answered results', async () => {
    const data = {
      stream: { _id: 'stream_1' },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderSnapshot: { name: 'Assistant' },
      parts: [
        {
          type: 'tool-shell',
          toolCallId: 'functions.shell:1',
          state: 'output-denied',
          input: { command: 'pwd' },
          approval: {
            id: 'approval_1',
            approved: false,
            reason: 'Denied by user.',
          },
        },
      ],
    }
    const ctx = {
      runQuery: async () => [message],
    } as never

    const history = await buildProviderHistory(ctx, data, [])

    expect(history).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
            input: { command: 'pwd' },
            providerExecuted: undefined,
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval_1',
            toolCallId: 'functions.shell:1',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: false,
            reason: 'Denied by user.',
            providerExecuted: undefined,
          },
          {
            type: 'tool-result',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
            output: { type: 'error-text', value: 'Denied by user.' },
            providerOptions: undefined,
          },
        ],
      },
    ])
  })
})

describe('removeOrphanToolCalls', () => {
  test('keeps a tool call with a matching tool result in the same segment', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'shell' },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'call-1', toolName: 'shell' },
        ],
      },
    ] as never

    expect(removeOrphanToolCalls(messages)).toEqual(messages)
  })

  test('drops a tool call without a matching tool result', () => {
    expect(
      removeOrphanToolCalls([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking.' },
            {
              type: 'tool-call',
              toolCallId: 'functions.shell:1',
              toolName: 'shell',
            },
            {
              type: 'tool-approval-request',
              approvalId: 'approval_1',
              toolCallId: 'functions.shell:1',
            },
          ],
        },
      ] as never),
    ).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Checking.' }],
      },
    ])
  })

  test('drops stale tool results without matching kept calls', () => {
    expect(
      removeOrphanToolCalls([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'functions.shell:1',
              toolName: 'shell',
            },
          ],
        },
      ] as never),
    ).toEqual([])
  })

  test('does not use an earlier stale tool result to keep a later tool call', () => {
    expect(
      removeOrphanToolCalls([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'functions.shell:1',
              toolName: 'shell',
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'functions.shell:1',
              toolName: 'shell',
            },
          ],
        },
      ] as never),
    ).toEqual([])
  })

  test('keeps approval responses for retained approval requests', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval_1',
            toolCallId: 'functions.shell:1',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
          },
        ],
      },
    ] as never

    expect(removeOrphanToolCalls(messages)).toEqual(messages)
  })

  test('keeps approved calls without results so tools can execute', () => {
    const messages = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'functions.shell:1',
            toolName: 'shell',
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval_1',
            toolCallId: 'functions.shell:1',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-approval-response',
            approvalId: 'approval_1',
            approved: true,
          },
        ],
      },
    ] as never

    expect(removeOrphanToolCalls(messages)).toEqual(messages)
  })

  test('drops approval responses for removed approval requests', () => {
    expect(
      removeOrphanToolCalls([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: 'aitxt-4ojB0Ptv0es2Ed0MrcRByrIA',
              approved: true,
            },
          ],
        },
      ] as never),
    ).toEqual([])
  })
})
