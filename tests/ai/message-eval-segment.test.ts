/// <reference types="bun-types" />
import { _applyMessageEval } from '@sb/convex/model/chat'
import { describe, expect, test } from 'bun:test'

type Row = Record<string, unknown> & { _id: string }

/** Fakes enough of the db for `getSegmentRow` + `setSegmentParts`. */
function mutationCtx({ message, segments }: { message: Row; segments: Row[] }) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
  const byId = new Map<string, Row>([
    [message._id, message],
    ...segments.map((row) => [row._id, row] as const),
  ])

  const ctx = {
    db: {
      get: async (id: string) => byId.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch })
        const doc = byId.get(id)
        if (doc) Object.assign(doc, patch)
      },
      query: () => {
        const captured: Record<string, unknown> = {}
        const q = {
          eq: (field: string, value: unknown) => {
            captured[field] = value
            return q
          },
        }
        const matches = () =>
          segments.filter(
            (row) =>
              row.messageId === captured.messageId &&
              row.version === captured.version &&
              (captured.segmentIndex === undefined ||
                row.segmentIndex === captured.segmentIndex),
          )
        return {
          withIndex: (_index: string, fn: (query: typeof q) => typeof q) => {
            fn(q)
            return {
              unique: async () => matches()[0] ?? null,
              collect: async () => matches(),
            }
          },
        }
      },
    },
  } as never

  return { ctx, patches }
}

const text = (value: string) => ({ type: 'text', text: value })

function fixture() {
  const message: Row = {
    _id: 'm_1',
    sessionId: 'session_1',
    selectedVersion: 1,
  }
  const segments: Row[] = [
    {
      _id: 'c_0',
      messageId: 'm_1',
      version: 1,
      segmentIndex: 0,
      parts: [text('a0')],
    },
    {
      _id: 'c_1',
      messageId: 'm_1',
      version: 1,
      segmentIndex: 1,
      parts: [text('b0')],
    },
  ]
  return { message, segments }
}

describe('_applyMessageEval', () => {
  test('writes only the target segment row', async () => {
    const { message, segments } = fixture()
    const { ctx, patches } = mutationCtx({ message, segments })

    await _applyMessageEval(ctx, {
      messageId: 'm_1' as never,
      version: 1,
      segmentIndex: 1,
      parts: [text('evaluated')],
      environment: {},
      dirty: false,
    })

    expect(segments[0].parts).toEqual([text('a0')])
    expect(segments[1].parts).toEqual([text('evaluated')])
    // Only the segment row and the doc's eligibility are touched
    expect(patches.map((p) => p.id).filter((id) => id === 'c_0')).toEqual([])
    expect(patches.map((p) => p.id).filter((id) => id === 'session_1')).toEqual(
      [],
    )
  })

  test('does nothing when the segment row is missing', async () => {
    const { ctx, patches } = mutationCtx(fixture())

    await _applyMessageEval(ctx, {
      messageId: 'm_1' as never,
      version: 2,
      segmentIndex: 0,
      parts: [text('evaluated')],
      environment: {},
      dirty: false,
    })

    expect(patches).toEqual([])
  })

  test('a non-selected version write skips the eligibility recompute', async () => {
    const { message, segments } = fixture()
    segments.push({
      _id: 'c_v2',
      messageId: 'm_1',
      version: 2,
      segmentIndex: 0,
      parts: [text('v2')],
    })
    const { ctx, patches } = mutationCtx({ message, segments })

    await _applyMessageEval(ctx, {
      messageId: 'm_1' as never,
      version: 2,
      segmentIndex: 0,
      parts: [],
      environment: {},
      dirty: false,
    })

    expect(patches.map((p) => p.id)).toEqual(['c_v2'])
  })

  test('patches the session environment when dirty', async () => {
    const { ctx, patches } = mutationCtx(fixture())

    await _applyMessageEval(ctx, {
      messageId: 'm_1' as never,
      version: 1,
      segmentIndex: 0,
      parts: [text('evaluated')],
      environment: { counter: 1 },
      dirty: true,
    })

    expect(patches.at(-1)).toEqual({
      id: 'session_1',
      patch: { environment: { counter: 1 } },
    })
  })
})
