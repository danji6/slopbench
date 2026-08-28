/// <reference types="bun-types" />
import {
  approveTool,
  hasPendingToolApprovals,
  patchToolApproval,
} from '@sb/convex/model/chat'
import { getEnabledTools } from '@sb/convex/model/tool/build'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import { describe, expect, test } from 'bun:test'

describe('.git access requires approval instead of failing', () => {
  const session = {
    _id: 'session_1',
    workspace: { workspaceId: 'ws_1' },
    // Auto-approvals never cover .git access
    toolApprovals: { tools: ['write_file', 'edit_file'], shell: ['cat'] },
  } as never

  const agentTools = ['read_file', 'write_file', 'edit_file', 'shell']

  const getTools = () =>
    getEnabledTools(
      resolveToolManifest({
        agent: { tools: agentTools } as never,
        invoker: { role: 'admin' } as never,
        session,
        resources: { settings: null, mcpServers: [] },
        spawnableAgents: [],
      } as never),
      session,
      null,
    )

  test('shell commands referencing .git always request approval', async () => {
    const tools = await getTools()
    const needsApproval = tools.shell.needsApproval as (
      input: unknown,
    ) => Promise<boolean>

    // Short-circuits before the sidecar path check
    expect(await needsApproval({ command: 'cat .git/config' })).toBe(true)
  })

  test('file tools gate .git paths even when auto-approved', async () => {
    const tools = await getTools()
    const needsApproval = (name: string, path: string) =>
      (tools[name]!.needsApproval as (input: unknown) => Promise<boolean>)({
        path,
      })

    for (const name of ['read_file', 'write_file', 'edit_file']) {
      expect(await needsApproval(name, '.git/hooks/pre-commit')).toBe(true)
      expect(await needsApproval(name, 'src/index.ts')).toBe(false)
    }
  })

  test('workspace tool executes no longer hard-block .git paths', async () => {
    const tools = await getTools()

    for (const name of ['read_file', 'write_file', 'edit_file', 'shell']) {
      const result = tools[name]!.execute?.(
        { path: '.git/config', command: 'cat .git/config' } as never,
        {} as never,
      )
      // Reaching the sidecar (instead of a synchronous .git rejection) is
      // the point: approval decides, not the execute
      if (Symbol.asyncIterator in ((result ?? {}) as object)) {
        await (result as AsyncGenerator).return(undefined)
      } else {
        await (result as Promise<unknown>).catch((err: Error) => {
          expect(err.message).not.toContain('.git directory')
        })
      }
    }
  })
})

describe('tool approval patching', () => {
  test('keeps approval pending until all requested tools are answered', () => {
    const parts = [tool('call-1', 'approval-1'), tool('call-2', 'approval-2')]

    const first = patchToolApproval(parts, {
      toolCallId: 'call-1',
      approved: true,
    })

    expect(first.hasPendingApprovals).toBe(true)
    expect(first.parts[0]).toMatchObject({
      state: 'approval-responded',
      approval: { id: 'approval-1', approved: true },
    })
    expect(first.parts[1]).toMatchObject({ state: 'approval-requested' })

    const second = patchToolApproval(first.parts, {
      toolCallId: 'call-2',
      approved: true,
    })

    expect(second.hasPendingApprovals).toBe(false)
  })

  test('counts denied approvals as answered', () => {
    const result = patchToolApproval([tool('call-1', 'approval-1')], {
      toolCallId: 'call-1',
      approved: false,
      reason: 'Denied by user.',
    })

    expect(result.hasPendingApprovals).toBe(false)
    expect(result.parts[0]).toMatchObject({
      state: 'output-denied',
      approval: {
        id: 'approval-1',
        approved: false,
        reason: 'Denied by user.',
      },
    })
  })

  test('surfaces the paths resolved when approval was requested', () => {
    const part = {
      ...tool('call-1', 'approval-1'),
      approvalPaths: ['/tmp/outside.c'],
    }

    const result = patchToolApproval([part], {
      toolCallId: 'call-1',
      approved: true,
    })

    expect(result.matched.paths).toEqual(['/tmp/outside.c'])
  })

  test('detects pending approvals only on tool parts', () => {
    expect(
      hasPendingToolApprovals([
        { type: 'text', state: 'approval-requested' },
        tool('call-1', 'approval-1'),
      ]),
    ).toBe(true)
    expect(
      hasPendingToolApprovals([
        { type: 'text', state: 'approval-requested' },
        { type: 'tool-shell', state: 'approval-responded' },
      ]),
    ).toBe(false)
  })
})

describe('plan approval timing', () => {
  test('approves the plan and exits plan mode before resuming the stream', async () => {
    const events: Array<{ id: string; patch: Record<string, unknown> }> = []
    const docs = new Map<string, Record<string, unknown>>([
      ['session_1', { _id: 'session_1', mode: 'plan' }],
      [
        'stream_1',
        {
          _id: 'stream_1',
          sessionId: 'session_1',
          status: 'awaiting_approval',
          operation: 'invoke',
          mode: 'plan',
          processingMessageId: 'message_1',
          processingContentId: 'content_1',
          leaseExpiresAt: Date.now() + 10_000,
        },
      ],
      ['message_1', { _id: 'message_1' }],
      [
        'content_1',
        {
          _id: 'content_1',
          segmentIndex: 0,
          parts: [
            {
              type: 'tool-exit_plan_mode',
              toolCallId: 'call_1',
              state: 'approval-requested',
              input: {},
              approval: { id: 'approval_1' },
            },
          ],
        },
      ],
      ['plan_1', { _id: 'plan_1', status: 'draft', content: '# Plan' }],
    ])
    const membership = {
      _id: 'membership_1',
      sessionId: 'session_1',
      userId: 'user_1',
      role: 'owner',
    }
    const ctx = {
      role: 'admin',
      userId: 'user_1',
      db: {
        get: async (id: string) => docs.get(id) ?? null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          events.push({ id, patch })
          Object.assign(docs.get(id) ?? {}, patch)
        },
        query: (table: string) => ({
          withIndex: () => ({
            unique: async () =>
              table === 'userSessions'
                ? membership
                : table === 'plans'
                  ? docs.get('plan_1')
                  : null,
            first: async () =>
              table === 'streams' ? docs.get('stream_1') : null,
          }),
        }),
      },
      scheduler: {
        runAfter: async () => 'job_1',
      },
    } as never

    await approveTool(ctx, {
      sessionId: 'session_1' as never,
      toolCallId: 'call_1',
      approved: true,
    })

    const planApproved = events.findIndex(
      ({ id, patch }) => id === 'plan_1' && patch.status === 'approved',
    )
    const modeChanged = events.findIndex(
      ({ id, patch }) => id === 'session_1' && 'mode' in patch,
    )
    const resumed = events.findIndex(
      ({ id, patch }) => id === 'stream_1' && patch.status === 'pending',
    )

    expect(planApproved).toBeGreaterThanOrEqual(0)
    expect(modeChanged).toBeGreaterThan(planApproved)
    expect(resumed).toBeGreaterThan(modeChanged)
  })
})

function tool(toolCallId: string, approvalId: string) {
  return {
    type: 'tool-shell',
    toolCallId,
    state: 'approval-requested',
    input: { command: 'pwd' },
    approval: { id: approvalId },
  }
}
