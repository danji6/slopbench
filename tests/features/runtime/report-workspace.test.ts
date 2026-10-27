import { deliverChildReport } from '@sb/convex/model/stream/subagents'
import type { ChildOutcome } from '@sb/convex/model/stream/subagents'
import { describe, expect, test } from 'bun:test'
import { fakeCtx } from '~/tests/setup/subagents'

const childStream = {
  _id: 'child_stream',
  sessionId: 'child',
  agentId: 'explorer',
  invokedBy: 'user_1',
  state: { processingMessageId: 'child_message' },
} as never

function setup(activeParent = false) {
  const folder = {
    _id: 'folder',
    ownerId: 'user_1',
    name: 'Project',
    revision: 1,
    sources: [{ id: 'root', path: '/repo', label: 'repo' }],
  }
  const parent = {
    _id: 'parent',
    ownerId: 'user_1',
    activeAgentId: 'coder',
    folderId: 'folder',
  }
  const fixture = fakeCtx({
    docs: [
      parent,
      folder,
      { _id: 'child', parent: { sessionId: 'parent' } },
      { _id: 'child_message', selectedVersion: 1 },
      { _id: 'coder', name: 'Coder' },
      { _id: 'explorer', name: 'Explore' },
    ],
    sessionAgents: [{ _id: 'link', sessionId: 'parent', agentId: 'coder' }],
    streamsBySession: activeParent
      ? {
          parent: [
            { _id: 'parent_stream', leaseExpiresAt: Date.now() + 60_000 },
          ],
        }
      : {},
  })
  return { ...fixture, parent, folder }
}

describe('workspace context when a sub-agent reports', () => {
  test.each<ChildOutcome>([
    { kind: 'complete' },
    { kind: 'failed', message: 'Failed task' },
    { kind: 'stopped' },
  ])(
    'defers workspace context to request preparation after a $kind report',
    async (outcome) => {
      const { ctx, inserts, scheduled } = setup()
      await deliverChildReport(ctx, childStream, outcome)

      expect(inserts.filter((row) => row.fields.type === 'workspace')).toEqual(
        [],
      )
      const report = inserts.find((row) => row.table === 'messages')!
      const invoke = inserts.find((row) => row.table === 'streams')!
      expect(report.fields.role).toBe('user')
      expect(invoke.fields.contextBoundaryMessageId).toBe('inserted_messages_1')
      expect(scheduled).toHaveLength(1)
    },
  )

  test.each([true, false])(
    'defers changed sources to request preparation (sources available: %s)',
    async (hasSources) => {
      const { ctx, folder, inserts, scheduled } = setup()
      folder.sources = hasSources
        ? [{ id: 'root', path: '/new-repo', label: 'new' }]
        : []
      folder.revision++
      await deliverChildReport(ctx, childStream, { kind: 'complete' })

      expect(inserts.filter((row) => row.fields.type === 'workspace')).toEqual(
        [],
      )
      const invoke = inserts.find((row) => row.table === 'streams')!
      expect(invoke.fields.contextBoundaryMessageId).toBe('inserted_messages_1')
      expect(scheduled).toHaveLength(1)
    },
  )

  test('honors a folder transition lock before announcing or scheduling', async () => {
    const { ctx, folder, inserts, scheduled } = setup()
    Object.assign(folder, { contextLock: `${Date.now() + 60_000}:transition` })
    await deliverChildReport(ctx, childStream, { kind: 'complete' })

    expect(inserts.filter((row) => row.fields.type === 'workspace')).toEqual([])
    expect(inserts.filter((row) => row.table === 'streams')).toEqual([])
    expect(scheduled).toHaveLength(0)
  })

  test('leaves announcements to the follow-up when the parent is active', async () => {
    const { ctx, inserts, scheduled } = setup(true)
    await deliverChildReport(ctx, childStream, { kind: 'complete' })

    expect(inserts.map((row) => row.table)).toEqual([
      'messages',
      'messageContents',
    ])
    expect(scheduled).toHaveLength(0)
  })
})
