import { workspaceKey } from '@sb/convex/model/session/folderContext'
import { folderWorkspace } from '@sb/convex/model/session/folderTree'
import { deliverChildReport } from '@sb/convex/model/stream/subagents'
import type { ChildOutcome } from '@sb/convex/model/stream/subagents'
import { describe, expect, test } from 'bun:test'

import { fakeCtx } from '../setup/subagents'

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
  const workspace = folderWorkspace(folder as never)
  const parent = {
    _id: 'parent',
    ownerId: 'user_1',
    activeAgentId: 'coder',
    folderId: 'folder',
    workspaceRevision: workspaceKey(workspace),
    announcedWorkspace: workspace,
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
  return { ...fixture, parent, folder, workspace }
}

describe('workspace context when a sub-agent reports', () => {
  test.each<ChildOutcome>([
    { kind: 'complete' },
    { kind: 'failed', message: 'Failed task' },
    { kind: 'stopped' },
  ])(
    'preserves the announced workspace after a $kind report',
    async (outcome) => {
      const { ctx, parent, workspace, inserts, scheduled } = setup()
      await deliverChildReport(ctx, childStream, outcome)

      expect(parent.announcedWorkspace).toEqual(workspace)
      expect(parent.workspaceRevision).toBe(workspaceKey(workspace))
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

  test('announces changed sources before waking the parent', async () => {
    const { ctx, folder, parent, inserts } = setup()
    folder.sources = [{ id: 'root', path: '/new-repo', label: 'new' }]
    folder.revision++
    await deliverChildReport(ctx, childStream, { kind: 'complete' })

    const noteIndex = inserts.findIndex(
      (row) => row.fields.type === 'workspace',
    )
    expect(inserts[noteIndex].fields.extra).toMatchObject({
      label: 'Project',
      fingerprint: expect.any(String),
    })
    expect(inserts[noteIndex + 1].fields.parts).toMatchObject([
      { type: 'text', text: expect.stringContaining('/new-repo') },
    ])
    expect(parent.announcedWorkspace?.path).toBe('/new-repo')
    const invoke = inserts.find((row) => row.table === 'streams')!
    expect(invoke.fields.contextBoundaryMessageId).toBe(
      `inserted_messages_${noteIndex + 1}`,
    )
  })

  test('announces genuine source removal', async () => {
    const { ctx, folder, parent, inserts } = setup()
    folder.sources = []
    folder.revision++
    await deliverChildReport(ctx, childStream, { kind: 'complete' })

    expect(inserts.some((row) => row.fields.type === 'workspace')).toBe(true)
    expect(parent.workspaceRevision).toBe('[]')
    expect(parent.announcedWorkspace).toBeUndefined()
    expect(
      inserts.some((row) =>
        JSON.stringify(row.fields.parts ?? []).includes(
          'This session has no folder source directories.',
        ),
      ),
    ).toBe(true)
  })

  test('repairs announcement state left by a previous false unbound note', async () => {
    const { ctx, parent, workspace, inserts } = setup()
    Object.assign(parent, {
      workspaceRevision: '[]',
      announcedWorkspace: undefined,
    })
    await deliverChildReport(ctx, childStream, { kind: 'complete' })

    expect(parent.announcedWorkspace).toEqual(workspace)
    expect(parent.workspaceRevision).toBe(workspaceKey(workspace))
    expect(
      inserts.find((row) => row.fields.type === 'workspace')?.fields.extra,
    ).toMatchObject({ label: 'Project', fingerprint: expect.any(String) })
  })

  test('honors a folder transition lock before announcing or scheduling', async () => {
    const { ctx, folder, parent, workspace, inserts, scheduled } = setup()
    Object.assign(folder, { contextLock: `${Date.now() + 60_000}:transition` })
    await deliverChildReport(ctx, childStream, { kind: 'complete' })

    expect(parent.announcedWorkspace).toEqual(workspace)
    expect(inserts.filter((row) => row.fields.type === 'workspace')).toEqual([])
    expect(inserts.filter((row) => row.table === 'streams')).toEqual([])
    expect(scheduled).toHaveLength(0)
  })

  test('leaves announcements to the follow-up when the parent is active', async () => {
    const { ctx, parent, workspace, inserts, scheduled } = setup(true)
    await deliverChildReport(ctx, childStream, { kind: 'complete' })

    expect(parent.announcedWorkspace).toEqual(workspace)
    expect(inserts.map((row) => row.table)).toEqual([
      'messages',
      'messageContents',
    ])
    expect(scheduled).toHaveLength(0)
  })
})
