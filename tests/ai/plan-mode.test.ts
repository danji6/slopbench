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
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import { getEnabledTools } from '@sb/convex/model/tool/build'
import { withPlanModeReminders } from '@sb/convex/model/tool/plan'
import { PLAN_TOOL_TOGGLE } from '@sb/core/const'
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

describe('frozen tool manifest', () => {
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
    PLAN_TOOL_TOGGLE,
  ]

  const manifestFor = (
    tools: string[] = agentTools,
    over: Record<string, unknown> = {},
  ) =>
    resolveToolManifest({
      agent: { tools } as never,
      invoker: { role: 'admin' } as never,
      session,
      settings: null,
      spawnableAgents: [],
      ...over,
    } as never)

  test('the manifest is mode-independent', () => {
    // Nothing about session mode or plan status is an input, so a plan
    // approval mid-turn cannot shift the cached prefix
    const names = manifestFor().names

    expect(names).toContain('write_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('write_plan')
    expect(names).toContain('edit_plan')
    expect(names).toContain('enter_plan_mode')
    expect(names).toContain('exit_plan_mode')
  })

  test('shell companions ride along with shell', () => {
    expect(manifestFor().names).toContain('shell_output')
    expect(manifestFor().names).toContain('kill_shell')
    expect(manifestFor(['read_file']).names).not.toContain('shell_output')
  })

  test('planning tools need the toggle and an admin invoker', () => {
    const withoutToggle = manifestFor(['read_file']).names
    expect(withoutToggle).not.toContain('write_plan')
    expect(withoutToggle).not.toContain('exit_plan_mode')

    const asUser = manifestFor(agentTools, {
      invoker: { role: 'user' },
    }).names
    expect(asUser).not.toContain('write_plan')
    expect(asUser).not.toContain('exit_plan_mode')
  })

  test('sub-agents plan but never transition modes', () => {
    const names = manifestFor(agentTools, {
      session: { ...(session as object), parent: { sessionId: 'session_p' } },
    }).names

    expect(names).toContain('write_plan')
    expect(names).toContain('edit_plan')
    expect(names).not.toContain('exit_plan_mode')
    expect(names).not.toContain('enter_plan_mode')
  })

  test('the task roster is frozen into the description', async () => {
    const manifest = manifestFor(agentTools, {
      spawnableAgents: [{ name: 'Explore', description: 'Searches' }],
    })
    expect(manifest.names).toContain('task')
    expect(manifest.taskRoster).toContain('- Explore: Searches')

    const tools = await getEnabledTools(manifest, session, null, {
      ctx: fakeCtx,
    })
    expect(tools.task?.description).toContain('- Explore: Searches')
  })

  const fakeCtx = {
    runQuery: async () => null,
    runMutation: async () => undefined,
  } as never

  const planCtx = {
    runQuery: async () => 'plan',
    runMutation: async () => undefined,
  } as never

  test('write_file stays on the wire but refuses in plan mode', async () => {
    const manifest = manifestFor()
    const tools = await getEnabledTools(manifest, session, null, {
      ctx: planCtx,
    })

    expect(Object.keys(tools)).toContain('write_file')
    expect(
      tools.write_file.execute?.({ path: 'a.ts', content: 'x' }, {} as never),
    ).rejects.toThrow('Plan mode is active')
    expect(
      tools.edit_file.execute?.({ path: 'a.ts', edits: [] }, {} as never),
    ).rejects.toThrow('Plan mode is active')
  })

  test('plan mode gates non-read-only shell commands behind approval', async () => {
    const tools = await getEnabledTools(manifestFor(), session, null, {
      ctx: planCtx,
    })
    const needsApproval = tools.shell.needsApproval as (
      input: unknown,
    ) => Promise<boolean>

    // Short-circuits before the sidecar path check
    expect(await needsApproval({ command: 'rm -rf src' })).toBe(true)
    expect(await needsApproval({ command: 'find . -delete' })).toBe(true)
  })

  test('the real shell execute stays synchronously iterable', async () => {
    const tools = await getEnabledTools(manifestFor(), session, null, {
      ctx: planCtx,
    })

    const result = tools.shell.execute?.({ command: 'rm -rf src' }, {} as never)
    expect(Symbol.asyncIterator in (result as object)).toBe(true)

    // Close without consuming: the generator never started, no sidecar call
    await (result as AsyncGenerator).return(undefined)
  })

  test('children write to the parent session plan', async () => {
    const writes: unknown[] = []
    const ctx = {
      runQuery: async () => null,
      runMutation: async (_ref: unknown, args: unknown) => {
        writes.push(args)
      },
    } as never
    const childSession = {
      _id: 'session_child',
      workspace: { workspaceId: 'ws_1' },
      toolApprovals: undefined,
      parent: { sessionId: 'session_parent' },
    } as never

    const tools = await getEnabledTools(
      manifestFor(agentTools, { session: childSession }),
      childSession,
      null,
      { ctx },
    )

    await tools.write_plan.execute?.({ content: '# Plan' }, {} as never)

    expect(writes).toEqual([{ sessionId: 'session_parent', content: '# Plan' }])
  })
})

describe('plan mode reminders', () => {
  const planContext = {
    ctx: { runQuery: async () => 'plan' },
    sessionId: 'session_1',
  } as never

  const normalContext = {
    ctx: { runQuery: async () => null },
    sessionId: 'session_1',
  } as never

  test('rides a reminder on string tool outputs while planning', async () => {
    const tools = withPlanModeReminders(
      { read_file: { execute: async () => 'file contents' } } as never,
      planContext,
    )

    const output = await tools.read_file!.execute?.({} as never, {} as never)

    expect(output).toContain('file contents')
    expect(output).toContain('<system-reminder>\nPlan mode is active')
  })

  test('stays silent outside plan mode', async () => {
    const tools = withPlanModeReminders(
      { read_file: { execute: async () => 'file contents' } } as never,
      normalContext,
    )

    const output = await tools.read_file!.execute?.({} as never, {} as never)

    expect(output).toBe('file contents')
  })

  test('rides the reminder on the final streaming output only', async () => {
    async function* run() {
      yield shellOutput('running', '')
      yield shellOutput('completed', 'done')
    }
    const tools = withPlanModeReminders(
      { shell: { execute: () => run() } } as never,
      planContext,
    )

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
      '<system-reminder>\nPlan mode is active',
    )
  })

  test('plan tool outputs skip the reminder', async () => {
    const writes: unknown[] = []
    const ctx = {
      runQuery: async () => 'plan',
      runMutation: async (_ref: unknown, args: unknown) => {
        writes.push(args)
      },
    } as never
    const session = {
      _id: 'session_1',
      workspace: { workspaceId: 'ws_1' },
      toolApprovals: undefined,
    } as never

    const tools = await getEnabledTools(
      resolveToolManifest({
        agent: { tools: [PLAN_TOOL_TOGGLE] } as never,
        invoker: { role: 'admin' } as never,
        session,
        settings: null,
        spawnableAgents: [],
      } as never),
      session,
      null,
      { ctx },
    )

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

  const buildTools = (queryResult: unknown) =>
    getEnabledTools(
      resolveToolManifest({
        agent: { tools: ['read_file', PLAN_TOOL_TOGGLE] } as never,
        invoker: { role: 'admin' } as never,
        session,
        settings: null,
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

describe('plan prompts', () => {
  test('the default plan prompt has a report-oriented sub-agent variant', () => {
    const [prompt] = resolvePlanPrompts(null, true)
    const content = (prompt as { content: string }).content

    expect(content).toContain('delegating agent')
    expect(content).not.toContain('exit_plan_mode')

    const [normal] = resolvePlanPrompts(null)
    expect((normal as { content: string }).content).toContain('exit_plan_mode')
  })
})
