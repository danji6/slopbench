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
import {
  TOOL_CALL_ID,
  mutationCtx,
  output,
  partOf,
  runnerCtx,
  shellPart,
} from '~/tests/helpers/user-shell'

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

describe('_beginUserShellWindow', () => {
  test('claims the command and leaves a heartbeat for the reaper', async () => {
    const { ctx, row } = mutationCtx([shellPart()])

    const claim = await _beginUserShellWindow(ctx as never, {
      messageId: 'msg-1' as never,
    })

    expect(claim).toMatchObject({
      sessionId: 'session-1',
      workspaceId: 'ws-1',
      command: 'ls -la',
      toolCallId: TOOL_CALL_ID,
    })
    // The first window has no job to pick up
    expect(claim?.resume).toBeUndefined()
    expect(partOf(row).heartbeatAt).toBeNumber()
  })

  test('hands the running job to the next window', async () => {
    const { ctx } = mutationCtx([
      shellPart({
        state: 'output-available',
        preliminary: true,
        output: output({ status: 'running', text: '', exitCode: null }),
      }),
    ])

    const claim = await _beginUserShellWindow(ctx as never, {
      messageId: 'msg-1' as never,
    })

    expect(claim?.resume).toEqual({
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

  test('schedules another window instead of settling a running command', async () => {
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
    // The next window resumes from the scrollback this one persisted
    expect(patches.at(-1)?.term).toBe('tick\n')
  })

  test('resumes the job a previous window left running', async () => {
    const { ctx, finishes, posts, post, openStream } = runnerCtx(
      [output({ status: 'done', exitCode: 0 })],
      {
        claim: {
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
    // The duration spans every window, not just the last one
    expect(finishes[0].duration as number).toBeGreaterThanOrEqual(60_000)
    expect((finishes[0].output as ShellToolOutput).term).toBe('earlier\n')
  })

  test('does nothing when the message is already gone', async () => {
    const { ctx, patches, finishes, post, openStream } = runnerCtx([], {
      claim: null,
    })

    await _run(ctx as never, args, {
      post: post as never,
      openStream: openStream as never,
    })

    expect(patches).toHaveLength(0)
    expect(finishes).toHaveLength(0)
  })
})
