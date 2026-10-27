import { prefixSenderName } from '@sb/convex/actions/stream/history'
import { toPlanBlock } from '@sb/convex/lib/workspace'
import { applyPlanModeTransition } from '@sb/convex/model/chat'
import { _edit, createPlanLinkPart } from '@sb/convex/model/plans'
import { getEnabledTools } from '@sb/convex/model/tool/build'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import { PLAN_TOOL_TOGGLE } from '@sb/core/const'
import { describe, expect, test } from 'bun:test'

describe('plan-link parts', () => {
  test('snapshots content and status', () => {
    expect(createPlanLinkPart({ content: '# Plan', status: 'draft' })).toEqual({
      type: 'plan-link',
      snapshot: { content: '# Plan', status: 'draft' },
    })
  })

  test('renders as a plan block', () => {
    const block = toPlanBlock({ content: '# Plan\n- step', status: 'approved' })

    expect(block).toStartWith('<plan status="approved">')
    expect(block).toContain('# Plan\n- step')
    expect(block).toEndWith('</plan>')
  })

  test('sender-name prefixing skips plan blocks', () => {
    const message = {
      id: 'm1',
      role: 'user' as const,
      parts: [
        {
          type: 'text' as const,
          text: toPlanBlock({ content: '# Plan', status: 'draft' }),
        },
        { type: 'text' as const, text: 'hello' },
      ],
    }
    const stored = {
      sender: { type: 'user' },
      senderName: 'Null',
    } as never
    const agent = { shareUserDisplayNames: true } as never

    const parts = prefixSenderName(message, stored, agent)

    expect(parts[0]).toMatchObject({ text: message.parts[0].text })
    expect(parts[1]).toMatchObject({ text: 'Null: hello' })
  })
})

describe('plan edits', () => {
  function editCtx(plan: Record<string, unknown> | null) {
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
    const ctx = {
      db: {
        query: () => ({
          withIndex: () => ({ unique: async () => plan }),
        }),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch })
        },
      },
    } as never
    return { ctx, patches }
  }

  const sessionId = 'session_1' as never

  test('applies scoped edits against the current row', async () => {
    const { ctx, patches } = editCtx({
      _id: 'plan_1',
      content: '# Plan\n- old step\n',
    })

    const result = await _edit(ctx, {
      sessionId,
      edits: [{ oldText: 'old step', newText: 'new step' }],
    })

    expect(result).toMatchObject({ ok: true, content: '# Plan\n- new step\n' })
    expect(patches[0]).toMatchObject({
      id: 'plan_1',
      patch: { content: '# Plan\n- new step\n' },
    })
  })

  test('failed matches return the current content for re-sync', async () => {
    const { ctx, patches } = editCtx({
      _id: 'plan_1',
      content: '# Plan (edited by the user)\n',
    })

    const result = await _edit(ctx, {
      sessionId,
      edits: [{ oldText: 'not in the plan', newText: 'x' }],
    })

    expect(result.ok).toBe(false)
    expect(result.content).toBe('# Plan (edited by the user)\n')
    expect(patches).toEqual([])
  })

  test('editing a missing plan points the model at write_plan', async () => {
    const { ctx } = editCtx(null)

    const result = await _edit(ctx, {
      sessionId,
      edits: [{ oldText: 'a', newText: 'b' }],
    })

    expect(result).toMatchObject({ ok: false, content: null })
    if (!result.ok) expect(result.error).toContain('write_plan')
  })
})

describe('plan mode transitions', () => {
  function transitionCtx(
    plan: Record<string, unknown> | null,
    command: Record<string, unknown> = { kind: 'invoke' },
  ) {
    const patches: Array<{ id: string; patch: Record<string, unknown> }> = []
    const ctx = {
      db: {
        get: async () => ({ _id: 'stream_1', command }),
        query: () => ({
          withIndex: () => ({ unique: async () => plan }),
        }),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch })
        },
      },
    } as never
    return { ctx, patches }
  }

  const stream = { _id: 'stream_1', sessionId: 'session_1' } as never

  test('approving exit_plan_mode locks the plan and restores normal mode', async () => {
    const { ctx, patches } = transitionCtx({ _id: 'plan_1', status: 'draft' })

    await applyPlanModeTransition(ctx, stream, 'exit_plan_mode')

    expect(patches).toEqual([
      { id: 'plan_1', patch: { status: 'approved' } },
      { id: 'session_1', patch: { mode: undefined } },
      {
        id: 'stream_1',
        patch: { command: { kind: 'invoke', mode: undefined } },
      },
    ])
  })

  test('approving enter_plan_mode demotes the plan and enters plan mode', async () => {
    const { ctx, patches } = transitionCtx({
      _id: 'plan_1',
      status: 'approved',
    })

    await applyPlanModeTransition(ctx, stream, 'enter_plan_mode')

    expect(patches).toEqual([
      { id: 'plan_1', patch: { status: 'draft' } },
      { id: 'session_1', patch: { mode: 'plan' } },
      { id: 'stream_1', patch: { command: { kind: 'invoke', mode: 'plan' } } },
    ])
  })

  test('retry plan-mode transitions retain restoration data', async () => {
    const { ctx, patches } = transitionCtx(
      { _id: 'plan_1', status: 'approved' },
      { kind: 'retry', previousVersion: 2 },
    )
    await applyPlanModeTransition(ctx, stream, 'enter_plan_mode')
    expect(patches.at(-1)).toEqual({
      id: 'stream_1',
      patch: { command: { kind: 'retry', previousVersion: 2, mode: 'plan' } },
    })
  })

  test('one-shot compaction commands do not acquire plan-mode fields', async () => {
    const { ctx, patches } = transitionCtx(
      { _id: 'plan_1', status: 'approved' },
      { kind: 'compact' },
    )
    await applyPlanModeTransition(ctx, stream, 'enter_plan_mode')
    expect(patches.some(({ id }) => id === 'stream_1')).toBe(false)
  })

  test('other tools leave modes untouched', async () => {
    const { ctx, patches } = transitionCtx({ _id: 'plan_1', status: 'draft' })

    await applyPlanModeTransition(ctx, stream, 'shell')

    expect(patches).toEqual([])
  })
})

describe('plan mode transition tools', () => {
  const session = {
    _id: 'session_1',
    workspace: { workspaceId: 'ws_1' },
    toolApprovals: undefined,
  } as never

  const buildTools = (queryResult: unknown) =>
    getEnabledTools(
      resolveToolManifest({
        agent: { tools: ['read_file', PLAN_TOOL_TOGGLE] } as never,
        invoker: { role: 'admin' } as never,
        session,
        resources: { settings: null, mcpServers: [] },
        spawnableAgents: [],
      } as never),
      session,
      null,
      {
        ctx: {
          runQuery: async () => queryResult,
          runMutation: async () => undefined,
        } as never,
      },
    )

  async function resolveNeedsApproval(tool: unknown): Promise<boolean> {
    const needsApproval = (tool as { needsApproval?: unknown }).needsApproval
    if (typeof needsApproval !== 'function') return Boolean(needsApproval)
    return (needsApproval as (input: unknown, options: unknown) => boolean)(
      {},
      {},
    )
  }

  test('enter_plan_mode asks approval when the session is not planning', async () => {
    const tools = await buildTools(null)

    expect(await resolveNeedsApproval(tools.enter_plan_mode)).toBe(true)
  })

  test('unrestricted access suppresses plan transition approvals', async () => {
    const tools = await buildTools({ mode: 'unrestricted' })

    expect(await resolveNeedsApproval(tools.enter_plan_mode)).toBe(false)
    expect(await resolveNeedsApproval(tools.exit_plan_mode)).toBe(false)
  })

  test('enter_plan_mode is a quiet no-op when plan mode is already active', async () => {
    const tools = await buildTools('plan')

    expect(await resolveNeedsApproval(tools.enter_plan_mode)).toBe(false)
  })

  test('enter_plan_mode reads the mode live, after approval flipped it', async () => {
    const tools = await buildTools('plan')

    const output = await tools.enter_plan_mode.execute?.({}, {} as never)
    expect(output).toContain('write_plan')
  })

  test('exit_plan_mode asks approval for a non-empty draft', async () => {
    const tools = await buildTools({ content: '# Plan', status: 'draft' })

    expect(await resolveNeedsApproval(tools.exit_plan_mode)).toBe(true)
  })

  test('exit_plan_mode skips approval and fails fast when no plan exists', async () => {
    const tools = await buildTools(null)

    expect(await resolveNeedsApproval(tools.exit_plan_mode)).toBe(false)

    expect(tools.exit_plan_mode.execute?.({}, {} as never)).rejects.toThrow(
      'write_plan',
    )
  })

  test('exit_plan_mode never re-prompts for an approved plan', async () => {
    const tools = await buildTools({
      content: '# The Plan',
      status: 'approved',
    })

    expect(await resolveNeedsApproval(tools.exit_plan_mode)).toBe(false)

    const output = await tools.exit_plan_mode.execute?.({}, {} as never)
    expect(output).toContain('# The Plan')
  })
})
