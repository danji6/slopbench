import { buildProviderHistory } from '@sb/convex/actions/stream/history'
import { describe, expect, test } from 'bun:test'
import { SELF, agent } from '~/tests/helpers/provider-history'

describe('provider approval history', () => {
  test('drops incomplete tool calls from the current processing message', async () => {
    const data = {
      stream: {
        _id: 'stream_1',
        state: { processingMessageId: 'message_1' },
        command: { kind: 'invoke' },
      },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderName: 'Assistant',
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

  test('surfaces an unanswered approval-request as an interrupted result', async () => {
    // Left as a bare tool-call the AI SDK would drop it, blinding the model
    // and driving a retry loop. Report that approval was interrupted instead.
    const data = {
      stream: {
        state: { phase: 'streaming', processingMessageId: 'output' },
        _id: 'stream_1',
      },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderName: 'Assistant',
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
    expect(toolResult?.output.value).toContain('before approval was received')
    expect(toolResult?.output.value).not.toContain('denied')
  })

  test('keeps approved tool calls so they can execute', async () => {
    // Only in the turn being written: that call is about to run
    const data = {
      stream: {
        _id: 'stream_1',
        state: { processingMessageId: 'message_1' },
        command: { kind: 'invoke' },
      },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderName: 'Assistant',
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

  /**
   * The turn was stopped between approving the call and running it, so nothing
   * will ever execute it. Replayed as-is it reaches the provider as a tool_call
   * with no response message, which the request is rejected for.
   */
  test('answers an approved call a finished turn never ran', async () => {
    const data = {
      stream: {
        _id: 'stream_1',
        state: { processingMessageId: 'message_2' },
        command: { kind: 'invoke' },
      },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderName: 'Assistant',
      parts: [
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

    const answered = history
      .flatMap((entry) => (entry.role === 'tool' ? entry.content : []))
      .filter((part) => part.type === 'tool-result')

    expect(answered).toHaveLength(1)
    expect(answered[0]).toMatchObject({ toolCallId: 'functions.shell:1' })
  })

  test('keeps denied tool calls as answered results', async () => {
    const data = {
      stream: {
        state: { phase: 'streaming', processingMessageId: 'output' },
        _id: 'stream_1',
      },
      agent: agent(),
      settings: {},
    } as never
    const message = {
      _id: 'message_1',
      role: 'assistant',
      sender: { type: 'agent', id: SELF },
      senderName: 'Assistant',
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

test('keeps completed tool outputs in provider history', async () => {
  const data = {
    stream: {
      state: { phase: 'streaming', processingMessageId: 'output' },
      _id: 'stream_1',
    },
    agent: agent(),
    settings: {},
  } as never
  const message = {
    _id: 'message_1',
    role: 'assistant',
    sender: { type: 'agent', id: SELF },
    senderName: 'Assistant',
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
