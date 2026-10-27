import { isReadOnlyShellCommand } from '@sb/convex/lib/tool/approval'
import { getEnabledTools } from '@sb/convex/model/tool/build'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import { withPlanModeReminders } from '@sb/convex/model/tool/plan'
import { PLAN_TOOL_TOGGLE } from '@sb/core/const'
import { describe, expect, test } from 'bun:test'
import { shellOutput } from '~/tests/helpers/plan-mode'

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

describe('frozen tool manifest', () => {
  const session = {
    _id: 'session_1',
    workspace: { workspaceId: 'ws_1' },
    toolApprovals: undefined,
  } as never

  const agentTools = [
    'read_file',
    'edit_files',
    'task',
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
      resources: { settings: null, mcpServers: [] },
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
        resources: { settings: null, mcpServers: [] },
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
