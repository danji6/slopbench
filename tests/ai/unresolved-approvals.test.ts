/// <reference types="bun-types" />
import { removeOrphanToolCalls } from '@sb/convex/actions/stream/history'
import { shellHistoryTools } from '@sb/convex/model/tool/shell'
import { settleUnansweredToolParts } from '@sb/core/utils/tool-parts'
import { type UIMessage, convertToModelMessages } from 'ai'
import { describe, expect, test } from 'bun:test'

const toModel = async (parts: UIMessage['parts']) => {
  const messages = await convertToModelMessages(
    [{ id: 'm', role: 'assistant', parts } as UIMessage],
    { ignoreIncompleteToolCalls: true, tools: shellHistoryTools() },
  )
  return removeOrphanToolCalls(messages)
}

const toolResults = (messages: Awaited<ReturnType<typeof toModel>>) =>
  messages
    .flatMap((message) => (message.role === 'tool' ? message.content : []))
    .filter((part) => (part as { type: string }).type === 'tool-result') as {
    toolCallId: string
    output: { type: string; value?: string }
  }[]

const toolCallIds = (messages: Awaited<ReturnType<typeof toModel>>) =>
  messages
    .flatMap((message) =>
      message.role === 'assistant' && typeof message.content !== 'string'
        ? message.content
        : [],
    )
    .filter((part) => part.type === 'tool-call')
    .map((part) => (part as { toolCallId: string }).toolCallId)

const shellPart = (
  overrides: Record<string, unknown>,
): UIMessage['parts'][number] =>
  ({
    type: 'tool-shell',
    toolCallId: 'c1',
    input: { command: 'ls -la /workspace/' },
    ...overrides,
  }) as unknown as UIMessage['parts'][number]

/**
 * An approval-request that reaches history unanswered (e.g. a sub-agent's
 * auto-denied tool call that never got flipped to output-denied) must not
 * vanish: the AI SDK drops the orphan tool-call, leaving the model blind and
 * looping. Settling it converts it to a visible denied result.
 */
describe('settleUnansweredToolParts', () => {
  const pending = (): UIMessage['parts'] => [
    { type: 'text', text: 'Let me list the workspace.' },
    shellPart({ state: 'approval-requested', approval: { id: 'a1' } }),
  ]

  test('an unanswered approval-request otherwise vanishes from history', async () => {
    expect(toolResults(await toModel(pending()))).toHaveLength(0)
  })

  test('settling it surfaces a denied tool-result to the model', async () => {
    const [result] = toolResults(
      await toModel(settleUnansweredToolParts(pending())),
    )

    expect(result?.output.type).toBe('error-text')
    expect(result?.output.value).toContain('denied')
  })

  /**
   * The turn was stopped between approving a call and running it. The SDK
   * keeps emitting the tool-call (the approval response pairs with it), so the
   * request reaches the provider with a tool_call nothing ever answered:
   * "tool_call_ids did not have response messages".
   */
  test('an approved call the turn never ran answers itself', async () => {
    const approved = (): UIMessage['parts'] => [
      shellPart({
        state: 'approval-responded',
        approval: { id: 'a1', approved: true },
      }),
    ]

    const stranded = await toModel(approved())
    expect(toolCallIds(stranded)).toEqual(['c1'])
    expect(toolResults(stranded)).toHaveLength(0)

    const settled = await toModel(settleUnansweredToolParts(approved()))
    expect(toolCallIds(settled)).toEqual(['c1'])
    expect(toolResults(settled)[0]?.toolCallId).toBe('c1')
  })

  /** A call whose turn died mid-flight is dropped, losing what was attempted. */
  test('an unfinished call reports back instead of disappearing', async () => {
    const running = (): UIMessage['parts'] => [
      shellPart({ state: 'input-available' }),
    ]

    expect(toolCallIds(await toModel(running()))).toHaveLength(0)

    const settled = await toModel(settleUnansweredToolParts(running()))
    expect(toolCallIds(settled)).toEqual(['c1'])
    expect(toolResults(settled)[0]?.output.value).toContain('turn ended')
  })

  test('resolved and non-tool parts pass through untouched', () => {
    const answered: UIMessage['parts'] = [
      { type: 'text', text: 'hi' },
      shellPart({
        toolCallId: 'c2',
        state: 'output-available',
        output: { type: 'text', value: 'files' },
      }),
    ]
    expect(settleUnansweredToolParts(answered)).toEqual(answered)
  })
})
