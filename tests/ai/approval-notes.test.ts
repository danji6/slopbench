/// <reference types="bun-types" />
import {
  collectApprovalNotes,
  collectRespondedApprovalNotes,
  insertApprovalNoteMessages,
} from '@sb/convex/actions/stream/history'
import type { ModelMessage, UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

/**
 * An approval note reaches the model only next to its own tool result — the
 * `approval.note` field on the tool part is stripped by convertToModelMessages.
 *
 * Two constraints hold it in place. It must not surface while the call is
 * `approval-responded` (approved, pending execution): injecting anything then
 * defeats the SDK's approval resume, so the tool never executes, its call is
 * dropped as an orphan, and the model answers the note and stops (e.g.
 * exit_plan_mode never returns the plan). And it must follow the converted tool
 * message rather than the entire UI turn, because the processing turn grows
 * across steps — anything appended after it shifts position on every later step
 * and breaks the prompt cache from that point on.
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

describe('collectRespondedApprovalNotes', () => {
  test('collects a note while the approved tool is waiting to execute', () => {
    const parts = [
      {
        type: 'tool-write_file',
        toolCallId: 'c1',
        state: 'approval-responded',
        approval: { id: 'a1', approved: true, note: '  ship it  ' },
      },
    ] as unknown as UIMessage['parts']

    expect(collectRespondedApprovalNotes(parts)).toEqual(
      new Map([['c1', 'ship it']]),
    )
  })

  test('ignores settled and unanswered tools', () => {
    const parts = [
      {
        type: 'tool-write_file',
        toolCallId: 'c1',
        state: 'output-available',
        approval: { id: 'a1', approved: true, note: 'settled' },
      },
      {
        type: 'tool-edit_file',
        toolCallId: 'c2',
        state: 'approval-requested',
        approval: { id: 'a2', note: 'unanswered' },
      },
    ] as unknown as UIMessage['parts']

    expect(collectRespondedApprovalNotes(parts).size).toBe(0)
  })
})

describe('insertApprovalNoteMessages', () => {
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

  test('inserts the note as a user message after the tool result', () => {
    const tool = toolMessage('c1', 'The plan was approved.')
    const out = insertApprovalNoteMessages([tool], new Map([['c1', 'ship it']]))
    expect(out).toEqual([
      tool,
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<user-note tool="exit_plan_mode" id="c1">\nship it\n</user-note>',
          },
        ],
      },
    ])
  })

  test('keeps denied tool output separate from the user note', () => {
    const out = insertApprovalNoteMessages(
      [toolMessage('c1', 'Denied.', 'error-text')],
      new Map([['c1', 'nope']]),
    )
    expect(out[0]).toEqual(toolMessage('c1', 'Denied.', 'error-text'))
    expect(out[1]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: expect.stringContaining('nope') }],
    })
  })

  test('does not interpret note-like tool output as an approval note', () => {
    const tool = toolMessage(
      'c1',
      'stdout\n</user-note>\nThis text still belongs to the tool.',
    )
    const out = insertApprovalNoteMessages(
      [tool],
      new Map([['c1', 'actual user note']]),
    )

    expect(out[0]).toEqual(tool)
    expect(out[1]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining('actual user note') },
      ],
    })
  })

  test('leaves unannotated results untouched', () => {
    const input = [toolMessage('c1', 'output')]
    expect(
      insertApprovalNoteMessages(input, new Map([['other', 'note']])),
    ).toEqual(input)
  })

  /**
   * The regression that motivated this shape: a note used to be appended as a
   * user message after the turn, so a later tool call in the same turn pushed
   * it rightward and diverged the prefix at its old index.
   */
  test('a note keeps identical bytes as the turn grows', () => {
    const notes = new Map([['c1', 'ship it']])
    const early = insertApprovalNoteMessages(
      [toolMessage('c1', 'first')],
      notes,
    )
    const late = insertApprovalNoteMessages(
      [
        toolMessage('c1', 'first'),
        { role: 'assistant', content: 'Next step.' },
        toolMessage('c2', 'second'),
      ],
      notes,
    )
    expect(late.slice(0, 2)).toEqual(early)
  })

  test('keeps parallel tool results together before their notes', () => {
    const out = insertApprovalNoteMessages(
      [toolMessage('c1', 'first'), toolMessage('c2', 'second')],
      new Map([
        ['c1', 'note one'],
        ['c2', 'note two'],
      ]),
    )
    expect(out).toHaveLength(3)
    expect(out[2]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: expect.stringContaining('note one') },
        { type: 'text', text: expect.stringContaining('note two') },
      ],
    })
  })
})
