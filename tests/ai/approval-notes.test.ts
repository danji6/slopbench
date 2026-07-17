/// <reference types="bun-types" />
import { injectApprovalNotes } from '@sb/convex/actions/stream/history'
import type { UIMessage } from 'ai'
import { describe, expect, test } from 'bun:test'

/**
 * An approval note reaches the model only through an injected user message —
 * the `approval.note` field on the tool part is stripped by
 * convertToModelMessages. But it must be injected only AFTER the approved tool
 * has run. While the call is still `approval-responded` (approved, pending
 * execution), injecting a trailing user turn defeats the SDK's approval resume:
 * the tool never executes, its call is dropped as an orphan, and the model
 * answers the note and stops (e.g. exit_plan_mode never returns the plan).
 */
describe('injectApprovalNotes', () => {
  const turn = (state: string): UIMessage => ({
    id: 'assistant',
    role: 'assistant',
    parts: [
      {
        type: 'tool-exit_plan_mode',
        toolCallId: 'c1',
        state,
        input: {},
        approval: { id: 'a1', approved: true, note: 'ship it' },
        ...(state.startsWith('output-') && { output: 'The plan was approved.' }),
      },
    ] as unknown as UIMessage['parts'],
  })

  test('does not inject while an approved call is pending execution', () => {
    const out = injectApprovalNotes([turn('approval-responded')])
    expect(out).toHaveLength(1)
    expect(out.some((m) => m.role === 'user')).toBe(false)
  })

  test('injects the note after the tool has settled', () => {
    const out = injectApprovalNotes([turn('output-available')])
    expect(out).toHaveLength(2)
    expect(out[0]?.role).toBe('assistant')
    expect(out[1]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: 'ship it' }],
    })
  })

  test('injects the note for a denied call', () => {
    const out = injectApprovalNotes([turn('output-denied')])
    expect(out).toHaveLength(2)
    expect(out[1]?.role).toBe('user')
  })
})
