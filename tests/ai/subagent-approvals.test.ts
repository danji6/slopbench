/// <reference types="bun-types" />
import { approveTool } from '@sb/convex/model/chat/approvals'
import {
  getApprovals,
  setApprovalMode,
  setApprovals,
} from '@sb/convex/model/session/state'
import { pendingApprovals } from '@sb/convex/model/subagent/approvals'
import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import { createWriteFileTool } from '@sb/convex/model/tool/files'
import { createShellTool } from '@sb/convex/model/tool/shellTools'
import { describe, expect, test } from 'bun:test'

import { fakeCtx } from '../setup/subagents'

const parentId = 'parent' as never
const childId = 'child' as never
const siblingId = 'sibling' as never
const approval = (toolCallId: string, type = 'tool-shell') => ({
  type,
  toolCallId,
  input: { command: 'git push', path: 'output.txt', content: 'hello' },
  state: 'approval-requested',
  approval: { id: `approval_${toolCallId}` },
})

function setup(
  parts: Array<ReturnType<typeof approval> & { approvalPaths?: string[] }> = [
    approval('shell'),
    approval('write', 'tool-write_file'),
  ],
) {
  const parent = { _id: parentId, ownerId: 'user_1' }
  const child = {
    _id: childId,
    ownerId: 'user_1',
    parent: { sessionId: parentId },
    title: 'Update files',
  }
  const stream = {
    _id: 'child_stream',
    sessionId: childId,
    agentId: 'agent',
    status: 'awaiting_approval',
    leaseExpiresAt: Date.now() + 60_000,
    processingMessageId: 'message',
    processingContentId: 'content',
  }
  const parentStream = {
    ...stream,
    _id: 'parent_stream',
    sessionId: parentId,
    processingContentId: 'parent_content',
  }
  const parentState = {
    _id: 'parent_state',
    sessionId: parentId,
    toolApprovals: { shell: ['git status'] },
  }
  const childState = {
    _id: 'child_state',
    sessionId: childId,
    toolApprovals: { shell: ['git status'] },
  }
  return fakeCtx({
    docs: [
      parent,
      child,
      { _id: siblingId, parent: { sessionId: parentId } },
      stream,
      parentStream,
      { _id: 'parent_content', parts: [approval('shell')] },
      parentState,
      childState,
      { _id: 'agent', name: 'Writer' },
      { _id: 'message', selectedVersion: 1 },
      { _id: 'content', segmentIndex: 0, version: 1, parts },
    ],
    sessionsByParent: { [parentId]: [child] },
    streamsBySession: { [childId]: [stream], [parentId]: [parentStream] },
    // The responding member has no child membership.
    membershipsBySession: { [parentId]: [{ _id: 'member', userId: 'user_1' }] },
    sessionStates: [parentState, childState],
  })
}

describe('sub-agent approvals in the parent session', () => {
  test('lists pending child calls with identity and input for parent members', async () => {
    const { ctx } = setup()
    const requests = await pendingApprovals(ctx, { sessionId: parentId })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      sessionId: childId,
      agentName: 'Writer',
      title: 'Update files',
      parts: [approval('shell'), approval('write', 'tool-write_file')],
    })
  })

  test('approves and denies child calls, resuming only when all are settled', async () => {
    const { ctx, byId, scheduled } = setup()
    await approveTool(ctx, {
      sessionId: parentId,
      childSessionId: childId,
      toolCallId: 'shell',
      approved: true,
      note: 'Use the test remote',
      remember: 'patterns',
    })
    expect(byId.get('content')?.parts).toMatchObject([
      {
        state: 'approval-responded',
        approval: { approved: true, note: 'Use the test remote' },
      },
      { state: 'approval-requested' },
    ])
    expect(byId.get('parent_state')?.toolApprovals).toMatchObject({
      shell: ['git status', 'git push'],
    })
    expect((await getApprovals(ctx, siblingId)).shell).toEqual([
      'git status',
      'git push',
    ])
    expect(byId.get('child_state')?.toolApprovals).toEqual({
      shell: ['git status'],
    })
    expect(byId.get('child_stream')?.status).toBe('awaiting_approval')
    expect(scheduled).toHaveLength(0)

    await approveTool(ctx, {
      sessionId: parentId,
      childSessionId: childId,
      toolCallId: 'write',
      approved: false,
      reason: 'Do not write this file',
    })
    expect(byId.get('content')?.parts).toMatchObject([
      { state: 'approval-responded' },
      {
        state: 'output-denied',
        approval: { approved: false, reason: 'Do not write this file' },
      },
    ])
    expect(byId.get('child_stream')?.status).toBe('pending')
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.args[2]).toEqual({ streamId: 'child_stream' })
    expect(byId.get('parent_stream')?.status).toBe('awaiting_approval')
    expect(byId.get('parent_content')?.parts).toEqual([approval('shell')])
    expect(await pendingApprovals(ctx, { sessionId: parentId })).toEqual([])
  })

  test('rejects unrelated children without changing their requests', async () => {
    const { ctx, byId, patches, scheduled } = setup()
    byId.get(childId)!.parent = { sessionId: 'unrelated' }
    await expect(
      approveTool(ctx, {
        sessionId: parentId,
        childSessionId: childId,
        toolCallId: 'shell',
        approved: true,
      }),
    ).rejects.toThrow('Not found')
    expect(patches).toHaveLength(0)
    expect(scheduled).toHaveLength(0)
  })

  test('rejects non-members and non-admin approval responses', async () => {
    const { ctx } = setup()
    const outsider = { ...(ctx as object), userId: 'outsider' } as never
    await expect(
      pendingApprovals(outsider, { sessionId: parentId }),
    ).rejects.toThrow('Not found')
    await expect(
      approveTool(outsider, {
        sessionId: parentId,
        childSessionId: childId,
        toolCallId: 'shell',
        approved: true,
      }),
    ).rejects.toThrow('Not found')
    await expect(
      approveTool({ ...(ctx as object), role: 'user' } as never, {
        sessionId: parentId,
        childSessionId: childId,
        toolCallId: 'shell',
        approved: true,
      }),
    ).rejects.toThrow('Forbidden')
  })

  test('rejects stale responses after the child resumes', async () => {
    const { ctx } = setup([approval('shell')])
    const args = {
      sessionId: parentId,
      childSessionId: childId,
      toolCallId: 'shell',
      approved: true,
    }
    await approveTool(ctx, args)
    await expect(approveTool(ctx, args)).rejects.toThrow(
      'No tool approval is pending',
    )
  })
})

describe('sub-agent unrestricted access', () => {
  test('existing shell and file tools follow parent toggles in both directions', async () => {
    const { ctx } = setup()
    const context = {
      sessionId: parentId,
      ownerId: childId,
      workspaceId: 'workspace',
      approvals: () => getApprovals(ctx, childId),
      isPlanMode: async () => true,
    } as WorkspaceToolContext
    const shell = await createShellTool(context)
    const write = await createWriteFileTool(context)
    const needsApproval = async (tool: unknown, input: unknown) => {
      const predicate = (
        tool as {
          needsApproval: (input: never, options: never) => Promise<boolean>
        }
      ).needsApproval
      return predicate(input as never, {} as never)
    }

    for (const mode of ['unrestricted', 'ask', 'unrestricted'] as const) {
      await setApprovalMode(ctx, parentId, mode)
      const expected = mode !== 'unrestricted'
      expect(await needsApproval(shell, { command: 'rm -rf .git' })).toBe(
        expected,
      )
      expect(
        await needsApproval(write, { path: '.git/config', content: '' }),
      ).toBe(expected)
      expect((await getApprovals(ctx, childId)).shell).toEqual(['git status'])
    }
  })

  test('parent ask mode overrides a child snapshot with unrestricted access', async () => {
    const { ctx, byId } = setup()
    byId.get('child_state')!.toolApprovals = { mode: 'unrestricted' }
    expect((await getApprovals(ctx, childId)).mode).toBeUndefined()
  })
})

describe('shared remembered approvals', () => {
  test.each([
    { list: 'tools', values: ['write_file'] },
    { list: 'shell', values: ['git push'] },
    { list: 'paths', values: ['/tmp/shared'] },
  ] as const)(
    'shares additions and revocations for $list across existing agents',
    async ({ list, values }) => {
      const { ctx, byId } = setup()
      byId.get('child_state')!.toolApprovals = { [list]: [...values] }

      await setApprovals(ctx, parentId, list, [...values])
      for (const sessionId of [parentId, childId, siblingId]) {
        expect((await getApprovals(ctx, sessionId))[list]).toEqual([...values])
      }

      await setApprovals(ctx, parentId, list, [])
      for (const sessionId of [parentId, childId, siblingId]) {
        expect((await getApprovals(ctx, sessionId))[list]).toEqual([])
      }
    },
  )

  test('remembers a child tool approval in the main session', async () => {
    const { ctx } = setup([approval('write', 'tool-write_file')])
    await approveTool(ctx, {
      sessionId: parentId,
      childSessionId: childId,
      toolCallId: 'write',
      approved: true,
      remember: 'patterns',
    })
    for (const sessionId of [parentId, childId, siblingId]) {
      expect((await getApprovals(ctx, sessionId)).tools).toContain('write_file')
    }
  })

  test('remembers paths approved for a child in the main session', async () => {
    const { ctx, byId } = setup([
      { ...approval('shell'), approvalPaths: ['/tmp/shared'] },
    ])
    byId.get(childId)!.workspace = { workspaceId: 'workspace' }
    await approveTool(ctx, {
      sessionId: parentId,
      childSessionId: childId,
      toolCallId: 'shell',
      approved: true,
      remember: 'paths',
    })
    for (const sessionId of [parentId, childId, siblingId]) {
      expect((await getApprovals(ctx, sessionId)).paths).toEqual([
        '/tmp/shared',
      ])
    }
  })

  test('one-time approval leaves the shared policy and other requests untouched', async () => {
    const { ctx, byId } = setup([approval('shell')])
    const before = await getApprovals(ctx, parentId)
    await approveTool(ctx, {
      sessionId: parentId,
      childSessionId: childId,
      toolCallId: 'shell',
      approved: true,
    })
    expect(await getApprovals(ctx, parentId)).toEqual(before)
    expect(await getApprovals(ctx, siblingId)).toEqual(before)
    expect(byId.get('parent_content')?.parts).toEqual([approval('shell')])
  })
})
