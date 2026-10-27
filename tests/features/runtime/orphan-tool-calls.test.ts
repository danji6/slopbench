import { removeOrphanToolCalls } from '@sb/convex/actions/stream/history'
import { describe, expect, test } from 'bun:test'

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
