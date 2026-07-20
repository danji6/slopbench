/// <reference types="bun-types" />
import {
  hasPendingToolApprovals,
  patchToolApproval,
} from '@sb/convex/model/chat'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import { getEnabledTools } from '@sb/convex/model/tools'
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
        settings: null,
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
      (tools[name]!.needsApproval as (input: unknown) => boolean)({ path })

    for (const name of ['read_file', 'write_file', 'edit_file']) {
      expect(needsApproval(name, '.git/hooks/pre-commit')).toBe(true)
      expect(needsApproval(name, 'src/index.ts')).toBe(false)
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

function tool(toolCallId: string, approvalId: string) {
  return {
    type: 'tool-shell',
    toolCallId,
    state: 'approval-requested',
    input: { command: 'pwd' },
    approval: { id: approvalId },
  }
}
