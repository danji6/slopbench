/// <reference types="bun-types" />
import { representMessage } from '@sb/convex/actions/stream/history'
import { _run } from '@sb/convex/actions/tool/userShell'
import { toUserShellBlock } from '@sb/convex/lib/userShell'
import {
  _beginUserShellWindow,
  _finishUserShell,
  _patchUserShell,
  _reapUserShell,
} from '@sb/convex/model/chat/shell'
import type { ShellToolOutput } from '@sb/core/types/tools'
import { describe, expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'

type Part = Record<string, unknown>

const TOOL_CALL_ID = 'call-1'

function shellPart(overrides: Part = {}): Part {
  return {
    type: 'tool-shell',
    toolCallId: TOOL_CALL_ID,
    state: 'input-available',
    input: { command: 'ls -la' },
    ...overrides,
  }
}

function output(overrides: Partial<ShellToolOutput> = {}): ShellToolOutput {
  return {
    jobId: 'job-1',
    status: 'done',
    exitCode: 0,
    text: 'a.txt\nb.txt',
    term: '[32ma.txt[0m\nb.txt',
    termOffset: 0,
    ...overrides,
  }
}

/** Minimal mutation ctx over one message and its single content row. */
function mutationCtx(parts: Part[], message: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: 'msg-1',
    sessionId: 'session-1',
    status: 'processing',
    selectedVersion: 1,
    _creationTime: Date.now(),
    ...message,
  }
  const row = { _id: 'row-1', messageId: 'msg-1', version: 1, segmentIndex: 0, parts } // prettier-ignore
  // A titled session keeps `scheduleTitle` from doing anything
  const session = {
    _id: 'session-1',
    title: 'Session',
    workspace: { workspaceId: 'ws-1' },
  }
  const scheduled: unknown[] = []

  const ctx = {
    db: {
      get: async (id: string) =>
        id === 'msg-1' ? doc : id === 'session-1' ? session : null,
      patch: async (id: string, fields: Record<string, unknown>) => {
        Object.assign(id === 'row-1' ? row : doc, fields)
      },
      query: () => ({
        withIndex: () => ({
          unique: async () => row,
          collect: async () => [row],
          order: () => ({ first: async () => null }),
          first: async () => null,
        }),
      }),
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown) => {
        scheduled.push(ref)
      },
    },
  }

  return { ctx, doc, row, scheduled }
}

function partOf(row: { parts: Part[] }): Part {
  return row.parts[0]
}

describe('toUserShellBlock', () => {
  test('gives the model the command and its plain output', () => {
    const block = toUserShellBlock({
      type: 'tool-shell',
      toolCallId: TOOL_CALL_ID,
      state: 'output-available',
      input: { command: 'ls -la' },
      output: output(),
    })

    expect(block).toBe(
      '<user-shell status="done" exit-code="0" job="job-1">\n' +
        '$ ls -la\n\na.txt\nb.txt\n' +
        '</user-shell>',
    )
  })

  test('never leaks terminal scrollback', () => {
    const block = toUserShellBlock({
      type: 'tool-shell',
      toolCallId: TOOL_CALL_ID,
      state: 'output-available',
      input: { command: 'ls' },
      output: output({ term: '[31mred[0m' }),
    })

    expect(block).not.toContain('[31m')
  })

  test('reports a failed command with its error', () => {
    const block = toUserShellBlock({
      type: 'tool-shell',
      toolCallId: TOOL_CALL_ID,
      state: 'output-error',
      input: { command: 'nope' },
      errorText: 'Sidecar unreachable',
    })

    expect(block).toContain('status="failed"')
    expect(block).toContain('Sidecar unreachable')
  })

  test('marks a still-running command', () => {
    const block = toUserShellBlock({
      type: 'tool-shell',
      toolCallId: TOOL_CALL_ID,
      state: 'output-available',
      preliminary: true,
      input: { command: 'sleep 10' },
      output: output({ status: 'running', text: '', exitCode: null }),
    })

    expect(block).toContain('status="running"')
  })
})

describe('representMessage', () => {
  const agent = { _id: 'agent-1' } as never

  test('keeps the resolved shell block on a user message', () => {
    const text = toUserShellBlock({
      type: 'tool-shell',
      toolCallId: TOOL_CALL_ID,
      state: 'output-available',
      input: { command: 'ls' },
      output: output(),
    })

    const { role, parts } = representMessage(
      { role: 'user', sender: { type: 'user', id: 'user-1' } } as never,
      agent,
      [{ type: 'text', text }] as never,
    )

    expect(role).toBe('user')
    expect(parts).toHaveLength(1)
  })

  test('still strips raw tool parts off user messages', () => {
    const { parts } = representMessage(
      { role: 'user', sender: { type: 'user', id: 'user-1' } } as never,
      agent,
      [shellPart({ state: 'output-available', output: output() })] as never,
    )

    expect(parts).toHaveLength(0)
  })
})

describe('_patchUserShell', () => {
  test('marks the running output as preliminary', async () => {
    const { ctx, row } = mutationCtx([shellPart()])

    const alive = await _patchUserShell(ctx as never, {
      messageId: 'msg-1' as never,
      toolCallId: TOOL_CALL_ID,
      output: output({ status: 'running', text: '', exitCode: null }),
    })

    expect(alive).toBe(true)
    expect(partOf(row)).toMatchObject({
      state: 'output-available',
      preliminary: true,
    })
  })

  test('reports a settled message as gone so the runner stops', async () => {
    const { ctx } = mutationCtx([shellPart()], { status: 'done' })

    expect(
      await _patchUserShell(ctx as never, {
        messageId: 'msg-1' as never,
        toolCallId: TOOL_CALL_ID,
        output: output(),
      }),
    ).toBe(false)
  })
})

describe('_finishUserShell', () => {
  const finishArgs = {
    messageId: 'msg-1' as never,
    toolCallId: TOOL_CALL_ID,
    invokedBy: 'user-1' as never,
    silent: false,
    duration: 1200,
  }

  test('settles the part and the turn', async () => {
    const { ctx, doc, row } = mutationCtx([
      shellPart({ state: 'output-available', preliminary: true }),
    ])

    await _finishUserShell(ctx as never, { ...finishArgs, output: output() })

    expect(partOf(row)).toMatchObject({ state: 'output-available' })
    // A settled call must not keep reading as still running
    expect(partOf(row).preliminary).toBeUndefined()
    expect(doc.status).toBe('done')
    expect(doc.metadata).toMatchObject({ duration: 1200 })
  })

  test('turns a runner failure into a tool error', async () => {
    const { ctx, row } = mutationCtx([
      shellPart({ state: 'output-available', preliminary: true, output: output() }), // prettier-ignore
    ])

    await _finishUserShell(ctx as never, {
      ...finishArgs,
      errorText: 'Sidecar unreachable',
    })

    expect(partOf(row)).toMatchObject({
      state: 'output-error',
      errorText: 'Sidecar unreachable',
    })
    expect(partOf(row).output).toBeUndefined()
  })
})

describe('_beginUserShellSlice', () => {
  test('claims the command and leaves a heartbeat for the reaper', async () => {
    const { ctx, row } = mutationCtx([shellPart()])

    const slice = await _beginUserShellWindow(ctx as never, {
      messageId: 'msg-1' as never,
    })

    expect(slice).toMatchObject({
      sessionId: 'session-1',
      workspaceId: 'ws-1',
      command: 'ls -la',
      toolCallId: TOOL_CALL_ID,
    })
    // A first slice has no job to pick up
    expect(slice?.resume).toBeUndefined()
    expect(partOf(row).heartbeatAt).toBeNumber()
  })

  test('hands the running job to the next slice', async () => {
    const { ctx } = mutationCtx([
      shellPart({
        state: 'output-available',
        preliminary: true,
        output: output({ status: 'running', text: '', exitCode: null }),
      }),
    ])

    const slice = await _beginUserShellWindow(ctx as never, {
      messageId: 'msg-1' as never,
    })

    expect(slice?.resume).toEqual({
      jobId: 'job-1',
      term: output().term,
      termOffset: 0,
    })
  })

  test('refuses to claim a settled command', async () => {
    const { ctx } = mutationCtx([shellPart()], { status: 'done' })

    expect(
      await _beginUserShellWindow(ctx as never, {
        messageId: 'msg-1' as never,
      }),
    ).toBeNull()
  })
})

describe('_reapUserShell', () => {
  test('releases a message whose runner never reported back', async () => {
    const { ctx, doc, row } = mutationCtx([shellPart()], {
      _creationTime: Date.now() - 60 * 60 * 1000,
    })

    await _reapUserShell(ctx as never, { messageId: 'msg-1' as never })

    expect(doc.status).toBe('done')
    expect(partOf(row)).toMatchObject({ state: 'output-error' })
  })

  test('lets a command run on as long as its runner keeps checking in', async () => {
    const { ctx, doc, scheduled } = mutationCtx(
      [shellPart({ heartbeatAt: Date.now() })],
      { _creationTime: Date.now() - 60 * 60 * 1000 },
    )

    await _reapUserShell(ctx as never, { messageId: 'msg-1' as never })

    // Nothing is cut short; the reaper just comes back later
    expect(doc.status).toBe('processing')
    expect(scheduled).toHaveLength(1)
  })

  test('leaves a settled message alone', async () => {
    const settled = shellPart({ state: 'output-available', output: output() })
    const { ctx, row } = mutationCtx([settled], { status: 'done' })

    await _reapUserShell(ctx as never, { messageId: 'msg-1' as never })

    expect(partOf(row)).toEqual(settled)
  })
})

type RunnerOptions = {
  /** False once the message the command belongs to is gone. */
  alive?: boolean
  /** Null when the command can no longer be claimed. */
  slice?: Record<string, unknown> | null
  /** Keeps the scripted stream open so the slice deadline can end it. */
  stayOpen?: boolean
}

/** Collects the mutations `_run` makes against a scripted shell job. */
function runnerCtx(
  outputs: ShellToolOutput[],
  { alive = true, slice, stayOpen }: RunnerOptions = {},
) {
  const patches: ShellToolOutput[] = []
  const finishes: Record<string, unknown>[] = []
  const scheduled: string[] = []
  const posts: string[] = []

  const ctx = {
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never)
      if (name.endsWith('_beginUserShellSlice')) {
        return slice === undefined
          ? {
              sessionId: 'session-1',
              workspaceId: 'ws-1',
              command: 'ls -la',
              toolCallId: TOOL_CALL_ID,
              startedAt: Date.now(),
            }
          : slice
      }
      if (name.endsWith('_patchUserShell')) {
        patches.push(args.output as ShellToolOutput)
        return alive
      }
      finishes.push(args)
      return undefined
    },
    scheduler: {
      runAfter: async (_delay: number, ref: unknown) => {
        scheduled.push(getFunctionName(ref as never))
      },
    },
  }

  const post = async (path: string) => {
    posts.push(path)
    return { jobId: 'job-1', mode: 'foreground' }
  }
  async function* openStream(
    _path: string,
    _query: Record<string, string>,
    signal?: AbortSignal,
  ) {
    for (const next of outputs) {
      yield {
        event: next.status === 'running' ? 'chunk' : 'end',
        data:
          next.status === 'running'
            ? JSON.stringify({ text: next.term, nextOffset: next.term.length })
            : JSON.stringify({ status: next.status, exitCode: next.exitCode }),
      }
    }
    if (!stayOpen) return
    await new Promise<void>((resolve) =>
      signal?.addEventListener('abort', () => resolve(), { once: true }),
    )
  }

  return { ctx, patches, finishes, scheduled, posts, post, openStream }
}

describe('_run', () => {
  const args = {
    messageId: 'msg-1' as never,
    invokedBy: 'user-1' as never,
    silent: false,
  }

  test('streams running output and settles once', async () => {
    const { ctx, patches, finishes, post, openStream } = runnerCtx([
      output({ status: 'running', text: '', term: 'a.txt\n', exitCode: null }),
      output({ status: 'done', exitCode: 0 }),
    ])

    await _run(ctx as never, args, {
      post: post as never,
      openStream: openStream as never,
      pollIntervalMs: 1,
    })

    expect(patches.length).toBeGreaterThan(0)
    // Terminal states are the finish mutation's job, never a patch
    expect(patches.every((patch) => patch.status === 'running')).toBe(true)
    expect(finishes).toHaveLength(1)
    expect(finishes[0]).toMatchObject({ silent: false, toolCallId: TOOL_CALL_ID }) // prettier-ignore
    expect((finishes[0].output as ShellToolOutput).status).toBe('done')
  })

  test('kills the job and stops when the message was deleted', async () => {
    const { ctx, finishes, posts, post, openStream } = runnerCtx(
      [
        output({ status: 'running', text: '', term: 'x', exitCode: null }),
        output({ status: 'done', exitCode: 0 }),
      ],
      { alive: false },
    )

    await _run(ctx as never, args, {
      post: post as never,
      openStream: openStream as never,
      pollIntervalMs: 1,
    })

    expect(finishes).toHaveLength(0)
    // Nothing is left watching it, so it must not outlive the message
    expect(posts).toContain('/shell/kill')
  })

  test('schedules another slice instead of settling a running command', async () => {
    const { ctx, patches, finishes, scheduled, post, openStream } = runnerCtx(
      [output({ status: 'running', text: '', term: 'tick\n', exitCode: null })],
      { stayOpen: true },
    )

    await _run(ctx as never, args, {
      post: post as never,
      openStream: openStream as never,
      pollIntervalMs: 1,
      heartbeatMs: 1000,
      windowDeadline: Date.now() + 30,
    })

    expect(finishes).toHaveLength(0)
    expect(scheduled).toEqual(['actions/userShell:_run'])
    // The next slice resumes from the scrollback this one persisted
    expect(patches.at(-1)?.term).toBe('tick\n')
  })

  test('resumes the job a previous slice left running', async () => {
    const { ctx, finishes, posts, post, openStream } = runnerCtx(
      [output({ status: 'done', exitCode: 0 })],
      {
        slice: {
          sessionId: 'session-1',
          workspaceId: 'ws-1',
          command: 'ls -la',
          toolCallId: TOOL_CALL_ID,
          startedAt: Date.now() - 60_000,
          resume: { jobId: 'job-1', term: 'earlier\n', termOffset: 0 },
        },
      },
    )

    await _run(ctx as never, args, {
      post: post as never,
      openStream: openStream as never,
      pollIntervalMs: 1,
    })

    expect(posts).not.toContain('/shell/start')
    expect(finishes).toHaveLength(1)
    // The duration spans every slice, not just the last one
    expect(finishes[0].duration as number).toBeGreaterThanOrEqual(60_000)
    expect((finishes[0].output as ShellToolOutput).term).toBe('earlier\n')
  })

  test('does nothing when the message is already gone', async () => {
    const { ctx, patches, finishes, post, openStream } = runnerCtx([], {
      slice: null,
    })

    await _run(ctx as never, args, {
      post: post as never,
      openStream: openStream as never,
    })

    expect(patches).toHaveLength(0)
    expect(finishes).toHaveLength(0)
  })
})
