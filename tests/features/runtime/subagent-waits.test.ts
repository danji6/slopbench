import { resumeIfSettled } from '@sb/convex/model/stream/subagents'
import { describe, expect, test } from 'bun:test'
import { parentDocs } from '~/tests/helpers/subagent-lifecycle'
import { fakeCtx } from '~/tests/setup/subagents'

describe('resumeIfSettled user waits', () => {
  test('stays parked while another Q&A call is pending', async () => {
    const pending = {
      type: 'tool-ask',
      toolCallId: 'call_2',
      state: 'input-available',
      input: {
        questions: [
          {
            question: 'Another?',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
    }
    const docs = parentDocs([pending], {
      state: {
        phase: 'awaiting_input',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    })
    const { ctx, patches, scheduled, byId } = fakeCtx({ docs })

    await resumeIfSettled(ctx, byId.get('stream_1') as never, [pending])

    expect(scheduled).toHaveLength(0)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({ attempt: 0 }),
    })
  })

  test('moves from answered Q&A to a pending approval', async () => {
    const approval = {
      type: 'tool-shell',
      toolCallId: 'call_2',
      state: 'approval-requested',
      approval: { id: 'approval_2' },
    }
    const docs = parentDocs([approval], {
      state: {
        phase: 'awaiting_input',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
    })
    const { ctx, patches, scheduled, byId } = fakeCtx({ docs })

    await resumeIfSettled(ctx, byId.get('stream_1') as never, [approval])

    expect(scheduled).toHaveLength(0)
    expect(patches).toContainEqual({
      id: 'stream_1',
      patch: expect.objectContaining({
        state: expect.objectContaining({ phase: 'awaiting_approval' }),
      }),
    })
  })
})
