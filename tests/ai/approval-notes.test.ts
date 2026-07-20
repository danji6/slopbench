/// <reference types="bun-types" />
import {
  collectApprovalNotes,
  foldApprovalNotes,
} from '@sb/convex/actions/stream/history'
import type { ModelMessage, UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

/**
 * An approval note reaches the model only through its own tool result — the
 * `approval.note` field on the tool part is stripped by convertToModelMessages.
 *
 * Two constraints hold it in place. It must not surface while the call is
 * `approval-responded` (approved, pending execution): injecting anything then
 * defeats the SDK's approval resume, so the tool never executes, its call is
 * dropped as an orphan, and the model answers the note and stops (e.g.
 * exit_plan_mode never returns the plan). And it must ride the tool result
 * rather than a trailing user message, because the processing turn grows across
 * steps — anything appended after it shifts position on every later step and
 * breaks the prompt cache from that point on.
 */
describe('collectApprovalNotes', () => {
  const turn = (state: string, note = 'ship it'): UIMessage => ({
    id: 'assistant',
    role: 'assistant',
    parts: [
      {
        type: 'tool-exit_plan_mode',
        toolCallId: 'c1',
        state,
        input: {},
        approval: { id: 'a1', approved: true, note },
        ...(state.startsWith('output-') && {
          output: 'The plan was approved.',
        }),
      },
    ] as unknown as UIMessage['parts'],
  })

  test('does not collect while an approved call is pending execution', () => {
    expect(collectApprovalNotes([turn('approval-responded')]).size).toBe(0)
  })

  test('collects the note once the tool has settled', () => {
    expect(collectApprovalNotes([turn('output-available')])).toEqual(
      new Map([['c1', 'ship it']]),
    )
  })

  test('collects the note for a denied call', () => {
    expect(collectApprovalNotes([turn('output-denied')])).toEqual(
      new Map([['c1', 'ship it']]),
    )
  })

  test('ignores a blank note', () => {
    expect(collectApprovalNotes([turn('output-available', '   ')]).size).toBe(0)
  })
})

describe('foldApprovalNotes', () => {
  const toolMessage = (
    toolCallId: string,
    value: string,
    type: 'text' | 'error-text' = 'text',
  ): ModelMessage =>
    ({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId,
          toolName: 'exit_plan_mode',
          output: { type, value },
        },
      ],
    }) as ModelMessage

  const outputValue = (message: ModelMessage) =>
    (
      (message as { content: { output: { value: string } }[] }).content[0] as {
        output: { value: string }
      }
    ).output.value

  test('appends the note to the annotated tool result', () => {
    const out = foldApprovalNotes(
      [toolMessage('c1', 'The plan was approved.')],
      new Map([['c1', 'ship it']]),
    )
    expect(outputValue(out[0]!)).toBe(
      'The plan was approved.\n\n<user-note>\nship it\n</user-note>',
    )
  })

  test('folds a denied result the same way', () => {
    const out = foldApprovalNotes(
      [toolMessage('c1', 'Denied.', 'error-text')],
      new Map([['c1', 'nope']]),
    )
    expect(outputValue(out[0]!)).toContain('<user-note>\nnope\n</user-note>')
  })

  test('leaves unannotated results untouched', () => {
    const input = [toolMessage('c1', 'output')]
    expect(foldApprovalNotes(input, new Map([['other', 'note']]))).toEqual(
      input,
    )
  })

  /**
   * The regression that motivated this shape: a note used to be appended as a
   * user message after the turn, so a later tool call in the same turn pushed
   * it rightward and diverged the prefix at its old index.
   */
  test('a note keeps identical bytes as the turn grows', () => {
    const notes = new Map([['c1', 'ship it']])
    const early = foldApprovalNotes([toolMessage('c1', 'first')], notes)
    const late = foldApprovalNotes(
      [toolMessage('c1', 'first'), toolMessage('c2', 'second')],
      notes,
    )
    expect(late[0]).toEqual(early[0]!)
  })

  test('two notes in one turn do not rewrite each other', () => {
    const out = foldApprovalNotes(
      [toolMessage('c1', 'first'), toolMessage('c2', 'second')],
      new Map([
        ['c1', 'note one'],
        ['c2', 'note two'],
      ]),
    )
    expect(outputValue(out[0]!)).toContain('note one')
    expect(outputValue(out[0]!)).not.toContain('note two')
    expect(outputValue(out[1]!)).toContain('note two')
  })
})
