/// <reference types="bun-types" />
import { prefixSenderName } from '@sb/convex/actions/stream/history'
import { isReadOnlyShellCommand } from '@sb/convex/lib/tool/approval'
import { toPlanBlock } from '@sb/convex/lib/workspace'
import { applyPlanModeTransition } from '@sb/convex/model/chat'
import {
  DEFAULT_PLAN_PROMPT,
  createDefaultPlanPrompts,
} from '@sb/convex/model/defaults'
import { _edit, createPlanLinkPart } from '@sb/convex/model/plans'
import { resolvePlanPrompts } from '@sb/convex/model/prompt/prompts'
import {
  getEnabledTools,
  withPlanModeReminders,
} from '@sb/convex/model/tools'
import { describe, expect, test } from 'bun:test'

function shellOutput(status: string, text: string) {
  return { jobId: '1', status, exitCode: null, text, term: '', termOffset: 0 }
}

describe('read-only shell commands', () => {
  test.each([
    'git log --oneline',
    'ls -la',
    'cat package.json',
    'grep -rn x',
    'find . -maxdepth 2 -type d',
    "sed -n '1,50p' file.txt",
    'ls -la && echo "---GIT---" && git log --oneline -5 2>/dev/null && echo "---ROOT FILES---" && find . -maxdepth 2 -type d | head -50',
  ])('allows %s', (command) => {
    expect(isReadOnlyShellCommand(command)).toBe(true)
  })

  test.each([
    'rm -rf dist',
    'echo hi > file.txt',
    'git commit -m "x"',
    'npm install',
    'ls $(rm -rf /)',
    'find . -name "*.tmp" -delete',
    "sed -i 's/a/b/' file.txt",
  ])('rejects %s', (command) => {
    expect(isReadOnlyShellCommand(command)).toBe(false)
  })

  test('rejects a chain that mixes read-only and write segments', () => {
    expect(isReadOnlyShellCommand('git log && git push')).toBe(false)
  })
})

describe('plan prompts', () => {
  test('defaults to a leading system prompt followed by history', () => {
    const prompts = createDefaultPlanPrompts()

    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toMatchObject({
      role: 'system',
      content: DEFAULT_PLAN_PROMPT,
      enabled: true,
    })
    expect(prompts[1]).toMatchObject({ type: 'message-history' })
  })

  test('resolves configured prompts over the defaults', () => {
    const custom = [
      {
        id: 'custom-plan',
        name: 'Custom',
        role: 'system',
        content: 'Custom planning instructions.',
        enabled: true,
        visible: false,
        starter: false,
      },
    ]

    expect(resolvePlanPrompts(custom)).toBe(custom as never)
    expect(resolvePlanPrompts(undefined)).toMatchObject([
      { content: DEFAULT_PLAN_PROMPT },
      { type: 'message-history' },
    ])
    expect(resolvePlanPrompts([])).toMatchObject([
      { content: DEFAULT_PLAN_PROMPT },
      { type: 'message-history' },
    ])
  })
})

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
      senderSnapshot: { name: 'Null' },
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
  function transitionCtx(plan: Record<string, unknown> | null) {
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

  const stream = { _id: 'stream_1', sessionId: 'session_1' } as never

  test('approving exit_plan_mode locks the plan and restores normal mode', async () => {
    const { ctx, patches } = transitionCtx({ _id: 'plan_1', status: 'draft' })

    await applyPlanModeTransition(ctx, stream, 'exit_plan_mode')

    expect(patches).toEqual([
      { id: 'plan_1', patch: { status: 'approved' } },
      { id: 'session_1', patch: { mode: undefined } },
      { id: 'stream_1', patch: { mode: undefined } },
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
      { id: 'stream_1', patch: { mode: 'plan' } },
    ])
  })

  test('other tools leave modes untouched', async () => {
    const { ctx, patches } = transitionCtx({ _id: 'plan_1', status: 'draft' })

    await applyPlanModeTransition(ctx, stream, 'shell')

    expect(patches).toEqual([])
  })
})

describe('plan mode tool set', () => {
  const session = {
    _id: 'session_1',
    workspace: { workspaceId: 'ws_1' },
    toolApprovals: undefined,
  } as never

  const agentTools = [
    'read_file',
    'write_file',
    'edit_file',
    'shell',
    'web_fetch',
  ]

  const fakeCtx = {
    runQuery: async () => null,
    runMutation: async () => undefined,
  } as never

  test('plan mode disables write tools and adds the planning tools', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: fakeCtx,
      mode: 'plan',
      plan: null,
    })

    const names = Object.keys(tools)
    expect(names).toContain('read_file')
    expect(names).toContain('shell')
    expect(names).toContain('write_plan')
    expect(names).toContain('edit_plan')
    expect(names).toContain('exit_plan_mode')
    // Kept so an approved enter_plan_mode call from history can still
    // execute after the stream resumes in plan mode
    expect(names).toContain('enter_plan_mode')
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('edit_file')
  })

  test('normal mode keeps write tools and offers enter_plan_mode', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: fakeCtx,
      mode: undefined,
      plan: null,
    })

    const names = Object.keys(tools)
    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('enter_plan_mode')
    expect(names).not.toContain('write_plan')
    expect(names).not.toContain('edit_plan')
    expect(names).not.toContain('exit_plan_mode')
  })

  test('normal mode with an approved plan keeps edit_plan for progress', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: fakeCtx,
      plan: { status: 'approved' } as never,
    })

    expect(Object.keys(tools)).toContain('edit_plan')
    // Kept so an approved exit_plan_mode call from history can still echo
    // the plan after the stream resumes in normal mode
    expect(Object.keys(tools)).toContain('exit_plan_mode')
    expect(Object.keys(tools)).not.toContain('write_plan')
  })

  test('planning tools require an admin invoker', async () => {
    const tools = await getEnabledTools(agentTools, 'user', session, null, {
      ctx: fakeCtx,
      mode: 'plan',
      plan: null,
    })

    expect(Object.keys(tools)).not.toContain('write_plan')
    expect(Object.keys(tools)).not.toContain('exit_plan_mode')
  })

  test('plan mode rides a reminder on string tool outputs', async () => {
    const tools = withPlanModeReminders({
      read_file: { execute: async () => 'file contents' },
    } as never)

    const output = await tools.read_file!.execute?.({} as never, {} as never)

    expect(output).toContain('file contents')
    expect(output).toContain('<system-reminder>Plan mode is active')
  })

  test('plan mode rides the reminder on the final streaming output only', async () => {
    async function* run() {
      yield shellOutput('running', '')
      yield shellOutput('completed', 'done')
    }
    const tools = withPlanModeReminders({
      shell: { execute: () => run() },
    } as never)

    // The result must be a synchronously returned async iterable — the SDK
    // detects streaming tools on the raw return value, and a promise-wrapped
    // generator would itself become the (uncloneable) tool output
    const result = tools.shell!.execute?.({} as never, {} as never)
    expect(Symbol.asyncIterator in (result as object)).toBe(true)

    const outputs: { text: string }[] = []
    for await (const output of result as AsyncIterable<{ text: string }>) {
      outputs.push(output)
    }

    expect(outputs[0]?.text).toBe('')
    expect(outputs.at(-1)?.text).toContain(
      '<system-reminder>Plan mode is active',
    )
  })

  test('plan mode keeps the real shell execute synchronously iterable', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: fakeCtx,
      mode: 'plan',
      plan: null,
    })

    const result = tools.shell.execute?.({ command: 'rm -rf src' }, {} as never)
    expect(Symbol.asyncIterator in (result as object)).toBe(true)

    // Close without consuming: the generator never started, no sidecar call
    await (result as AsyncGenerator).return(undefined)
  })

  test('plan mode gates non-read-only shell commands behind approval', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: fakeCtx,
      mode: 'plan',
      plan: null,
    })
    const needsApproval = tools.shell.needsApproval as (
      input: unknown,
    ) => Promise<boolean>

    // Short-circuits before the sidecar path check
    expect(await needsApproval({ command: 'rm -rf src' })).toBe(true)
    expect(await needsApproval({ command: 'find . -delete' })).toBe(true)
  })

  test('plan tool outputs skip the reminder', async () => {
    const writes: unknown[] = []
    const ctx = {
      runQuery: async () => null,
      runMutation: async (_ref: unknown, args: unknown) => {
        writes.push(args)
      },
    } as never

    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx,
      mode: 'plan',
      plan: null,
    })

    const output = await tools.write_plan.execute?.(
      { content: '# Plan' },
      {} as never,
    )

    expect(output).toBe('Plan saved.')
    expect(writes).toEqual([{ sessionId: 'session_1', content: '# Plan' }])
  })
})

describe('plan mode transition tools', () => {
  const session = {
    _id: 'session_1',
    workspace: { workspaceId: 'ws_1' },
    toolApprovals: undefined,
  } as never

  const agentTools = ['read_file']

  const ctxWith = (queryResult: unknown) =>
    ({
      runQuery: async () => queryResult,
      runMutation: async () => undefined,
    }) as never

  async function resolveNeedsApproval(tool: unknown): Promise<boolean> {
    const needsApproval = (tool as { needsApproval?: unknown }).needsApproval
    if (typeof needsApproval !== 'function') return Boolean(needsApproval)
    return (needsApproval as (input: unknown, options: unknown) => boolean)(
      {},
      {},
    )
  }

  test('enter_plan_mode asks approval when the session is not planning', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: ctxWith(null),
      plan: null,
    })

    expect(await resolveNeedsApproval(tools.enter_plan_mode)).toBe(true)
  })

  test('enter_plan_mode is a quiet no-op when plan mode is already active', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: ctxWith('plan'),
      plan: null,
    })

    expect(await resolveNeedsApproval(tools.enter_plan_mode)).toBe(false)

    const output = await tools.enter_plan_mode.execute?.({}, {} as never)
    expect(output).toContain('already active')
  })

  test('enter_plan_mode on a plan-mode stream instructs to start planning', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: ctxWith('plan'),
      mode: 'plan',
      plan: null,
    })

    const output = await tools.enter_plan_mode.execute?.({}, {} as never)
    expect(output).toContain('write_plan')
  })

  test('exit_plan_mode asks approval for a non-empty draft', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: ctxWith({ content: '# Plan', status: 'draft' }),
      mode: 'plan',
      plan: null,
    })

    expect(await resolveNeedsApproval(tools.exit_plan_mode)).toBe(true)
  })

  test('exit_plan_mode skips approval and fails fast when no plan exists', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: ctxWith(null),
      mode: 'plan',
      plan: null,
    })

    expect(await resolveNeedsApproval(tools.exit_plan_mode)).toBe(false)

    const output = await tools.exit_plan_mode.execute?.({}, {} as never)
    expect(output).toContain('write_plan')
  })

  test('exit_plan_mode never re-prompts for an approved plan', async () => {
    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: ctxWith({ content: '# The Plan', status: 'approved' }),
      plan: { status: 'approved' } as never,
    })

    expect(await resolveNeedsApproval(tools.exit_plan_mode)).toBe(false)

    const output = await tools.exit_plan_mode.execute?.({}, {} as never)
    expect(output).toContain('# The Plan')
  })
})

describe('sub-agent planning tools', () => {
  const childSession = {
    _id: 'session_child',
    workspace: { workspaceId: 'ws_1' },
    toolApprovals: undefined,
    parent: {
      sessionId: 'session_parent',
      streamId: 'stream_parent',
      toolCallId: 'tc_1',
      agentId: 'agent_parent',
    },
  } as never

  const agentTools = ['read_file']

  const fakeCtx = {
    runQuery: async () => null,
    runMutation: async () => undefined,
  } as never

  const spawnableAgents = [{ _id: 'agent_explorer', name: 'Explore' }] as never

  test('plan mode exposes the task tool', async () => {
    const session = {
      _id: 'session_1',
      workspace: { workspaceId: 'ws_1' },
      toolApprovals: undefined,
    } as never

    const tools = await getEnabledTools(agentTools, 'admin', session, null, {
      ctx: fakeCtx,
      mode: 'plan',
      plan: null,
      spawnableAgents,
    })

    expect(Object.keys(tools)).toContain('task')
  })

  test('plan-mode children plan but cannot transition modes', async () => {
    const tools = await getEnabledTools(
      agentTools,
      'admin',
      childSession,
      null,
      { ctx: fakeCtx, mode: 'plan', plan: null },
    )

    const names = Object.keys(tools)
    expect(names).toContain('write_plan')
    expect(names).toContain('edit_plan')
    expect(names).not.toContain('exit_plan_mode')
    expect(names).not.toContain('enter_plan_mode')
  })

  test('children write to the parent session plan', async () => {
    const writes: unknown[] = []
    const ctx = {
      runQuery: async () => null,
      runMutation: async (_ref: unknown, args: unknown) => {
        writes.push(args)
      },
    } as never

    const tools = await getEnabledTools(
      agentTools,
      'admin',
      childSession,
      null,
      { ctx, mode: 'plan', plan: null },
    )

    await tools.write_plan.execute?.({ content: '# Plan' }, {} as never)

    expect(writes).toEqual([{ sessionId: 'session_parent', content: '# Plan' }])
  })

  test('normal-mode children never enter plan mode themselves', async () => {
    const tools = await getEnabledTools(
      agentTools,
      'admin',
      childSession,
      null,
      { ctx: fakeCtx, plan: null },
    )

    expect(Object.keys(tools)).not.toContain('enter_plan_mode')
  })

  test('an approved parent plan grants edit_plan but not exit_plan_mode', async () => {
    const tools = await getEnabledTools(
      agentTools,
      'admin',
      childSession,
      null,
      { ctx: fakeCtx, plan: { status: 'approved' } as never },
    )

    expect(Object.keys(tools)).toContain('edit_plan')
    expect(Object.keys(tools)).not.toContain('exit_plan_mode')
  })

  test('the default plan prompt has a report-oriented sub-agent variant', () => {
    const [prompt] = resolvePlanPrompts(null, true)
    const content = (prompt as { content: string }).content

    expect(content).toContain('delegating agent')
    expect(content).not.toContain('exit_plan_mode')

    const [normal] = resolvePlanPrompts(null)
    expect((normal as { content: string }).content).toContain('exit_plan_mode')
  })
})
