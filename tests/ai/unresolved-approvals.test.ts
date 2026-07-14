/// <reference types="bun-types" />
import {
  denyUnresolvedApprovals,
  removeOrphanToolCalls,
} from '@sb/convex/actions/stream/history'
import { shellHistoryTools } from '@sb/convex/model/tool/shell'
import { type UIMessage, convertToModelMessages } from 'ai'
import { describe, expect, test } from 'bun:test'

/**
 * An approval-request that reaches history unanswered (e.g. a sub-agent's
 * auto-denied tool call that never got flipped to output-denied) must not
 * vanish: the AI SDK drops the orphan tool-call, leaving the model blind and
 * looping. denyUnresolvedApprovals converts it to a visible denied result.
 */
describe('denyUnresolvedApprovals', () => {
  const pending = (): UIMessage['parts'] => [
    { type: 'text', text: 'Let me list the workspace.' },
    {
      type: 'tool-shell',
      toolCallId: 'c1',
      state: 'approval-requested',
      input: { command: 'ls -la /workspace/' },
      approval: { id: 'a1' },
    } as unknown as UIMessage['parts'][number],
  ]

  const toModel = async (parts: UIMessage['parts']) => {
    const messages = await convertToModelMessages(
      [{ id: 'm', role: 'assistant', parts } as UIMessage],
      { ignoreIncompleteToolCalls: true, tools: shellHistoryTools() },
    )
    return removeOrphanToolCalls(messages)
  }

  test('an unanswered approval-request otherwise vanishes from history', async () => {
    const model = await toModel(pending())
    const hasToolResult = model.some(
      (m) =>
        m.role === 'tool' &&
        (m.content as { type: string }[]).some((p) => p.type === 'tool-result'),
    )
    expect(hasToolResult).toBe(false)
  })

  test('normalizing it surfaces a denied tool-result to the model', async () => {
    const model = await toModel(denyUnresolvedApprovals(pending()))
    const result = model
      .flatMap((m) => (m.role === 'tool' ? m.content : []))
      .find((p) => (p as { type: string }).type === 'tool-result') as
      { output: { type: string; value: string } } | undefined

    expect(result?.output.type).toBe('error-text')
    expect(result?.output.value).toContain('denied')
  })

  test('resolved and non-tool parts pass through untouched', () => {
    const answered: UIMessage['parts'] = [
      { type: 'text', text: 'hi' },
      {
        type: 'tool-shell',
        toolCallId: 'c2',
        state: 'output-available',
        input: { command: 'ls' },
        output: { type: 'text', value: 'files' },
      } as unknown as UIMessage['parts'][number],
    ]
    expect(denyUnresolvedApprovals(answered)).toEqual(answered)
  })
})
