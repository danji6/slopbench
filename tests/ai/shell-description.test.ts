import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import {
  SHELL_DESCRIPTION_REQUIRED,
  shellApprovalPolicy,
} from '@sb/convex/model/tool/shellApproval'
import { createShellTool } from '@sb/convex/model/tool/shellTools'
import type { ToolApprovals } from '@sb/convex/types'
import type { ShellToolOutput } from '@sb/core/types/tools'
import { type ToolSet, streamText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'

import { startPathSidecar } from '../helpers/path-sidecar'

describe('shell approval descriptions', () => {
  let sidecar: Awaited<ReturnType<typeof startPathSidecar>>
  beforeAll(async () => {
    sidecar = await startPathSidecar()
  })
  afterAll(async () => {
    await sidecar.close()
  })

  async function run(
    command: string,
    description?: string,
    approvals?: ToolApprovals,
    plan = false,
  ) {
    const context = {
      sessionId: 'session',
      ownerId: 'session',
      workspaceId: 'workspace',
      approvals: async () => approvals,
      isPlanMode: async () => plan,
    } as WorkspaceToolContext
    const shell = await createShellTool(context)
    const execute = mock(async (): Promise<ShellToolOutput> => ({
      jobId: 'job',
      status: 'done',
      exitCode: 0,
      term: 'executed',
      termOffset: 0,
      text: 'executed',
    }))
    const tools = { shell: { ...shell, execute } } as unknown as ToolSet
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            controller.enqueue({
              type: 'tool-call',
              toolName: 'shell',
              toolCallId: 'call',
              input: JSON.stringify({ command, description }),
            })
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: undefined },
              usage: {
                inputTokens: {
                  total: 1,
                  noCache: 1,
                  cacheRead: 0,
                  cacheWrite: 0,
                },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            })
            controller.close()
          },
        }),
      }),
    })
    const result = streamText({
      model,
      tools,
      toolApproval: shellApprovalPolicy(tools),
      prompt: 'Run the command.',
    })
    const parts = await Array.fromAsync(result.fullStream)
    return { parts, execute }
  }

  test.each([undefined, '', ' \n\t '])(
    'denies an unsafe command without a nonblank description: %s',
    async (description) => {
      const { parts, execute } = await run('git push origin main', description)
      expect(execute).not.toHaveBeenCalled()
      expect(parts).toContainEqual(
        expect.objectContaining({
          type: 'tool-approval-response',
          approved: false,
          reason: SHELL_DESCRIPTION_REQUIRED,
        }),
      )
      expect(parts).toContainEqual(
        expect.objectContaining({ type: 'tool-output-denied' }),
      )
    },
  )

  test('requests user approval when an unsafe command is described', async () => {
    const { parts, execute } = await run(
      'git push origin main',
      'Push changes to the main branch',
    )
    expect(execute).not.toHaveBeenCalled()
    expect(parts).toContainEqual(
      expect.objectContaining({ type: 'tool-approval-request' }),
    )
    expect(parts.some((part) => part.type === 'tool-approval-response')).toBe(
      false,
    )
  })

  test.each([undefined, 'Print the current directory'])(
    'executes safe commands regardless of description: %s',
    async (description) => {
      const { parts, execute } = await run('pwd', description)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(parts.some((part) => part.type === 'tool-approval-request')).toBe(
        false,
      )
    },
  )

  test('does not require a description for a remembered command', async () => {
    const { execute } = await run('git push origin main', undefined, {
      shell: ['git push'],
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('preserves unrestricted mode', async () => {
    const { execute } = await run(
      'rm -rf .git',
      undefined,
      { mode: 'unrestricted' },
      true,
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })

  test('requires a description even for a read-only command accessing a forbidden path', async () => {
    const { parts, execute } = await run('cat .git/config')
    expect(execute).not.toHaveBeenCalled()
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: 'tool-approval-response',
        approved: false,
      }),
    )
  })

  test('keeps plan-mode and unavailable-path checks subject to the description rule', async () => {
    const planned = await run(
      'git push origin main',
      undefined,
      { shell: ['git push'] },
      true,
    )
    expect(planned.execute).not.toHaveBeenCalled()
    sidecar.setAvailable(false)
    try {
      const unavailable = await run('pwd')
      expect(unavailable.execute).not.toHaveBeenCalled()
      expect(unavailable.parts).toContainEqual(
        expect.objectContaining({
          type: 'tool-approval-response',
          approved: false,
        }),
      )
    } finally {
      sidecar.setAvailable(true)
    }
  })
})
