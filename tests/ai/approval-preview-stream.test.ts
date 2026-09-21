import {
  approvalHold,
  buildApprovalActions,
} from '@/lib/chat/tool-approval-policy'
import { consumeProviderStep } from '@sb/convex/actions/stream/engineStep'
import type { PathApprovalStatus } from '@sb/core/workspace/path-policy'
import { type UIMessage, tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { startPathSidecar } from '../helpers/path-sidecar'

type Setup = Parameters<typeof consumeProviderStep>[2]
type ApprovalPart = UIMessage['parts'][number] & {
  state?: string
  input?: { command: string }
  approvalPathStatus?: PathApprovalStatus
  approvalPaths?: string[]
}

function approvalModel(command: string) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({
            type: 'tool-call',
            toolCallId: 'shell-call',
            toolName: 'shell',
            input: JSON.stringify({ command }),
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
}

function captureApprovalContext() {
  const patches: ApprovalPart[][] = []
  const approvalSessions: string[] = []
  const ctx = {
    runQuery: async (
      ref: Parameters<typeof getFunctionName>[0],
      args: { sessionId?: string },
    ) => {
      if (getFunctionName(ref) === 'sessions:_getApprovals') {
        approvalSessions.push(args.sessionId!)
        return { paths: ['session-grant'] }
      }
      return true
    },
    runMutation: async (
      ref: Parameters<typeof getFunctionName>[0],
      args: { parts?: ApprovalPart[] },
    ) => {
      if (getFunctionName(ref) === 'streams:_patchMessage')
        patches.push(structuredClone(args.parts!))
      return true
    },
    storage: { store: async () => 'log' },
  } as unknown as Parameters<typeof consumeProviderStep>[0]
  return { ctx, patches, approvalSessions }
}

function streamSetup(isSubagent: boolean, command: string): Setup {
  return {
    isSubagent,
    stream: { sessionId: isSubagent ? 'child' : 'parent', invokedBy: 'user' },
    output: { _id: 'message', role: 'assistant', parts: [] },
    workspace: { workspaceId: 'workspace' },
    workspaceSessionId: 'parent',
    agent: { autoApprove: { paths: ['agent-grant'] } },
    resolved: { languageModel: approvalModel(command) },
    messages: [{ role: 'user', content: 'Search the workspace.' }],
    requestLog: {},
    tools: {
      shell: tool({
        inputSchema: z.object({ command: z.string() }),
        needsApproval: true,
      }),
    },
  } as unknown as Setup
}

async function streamApproval(isSubagent: boolean, command: string) {
  const { ctx, patches, approvalSessions } = captureApprovalContext()
  const result = await consumeProviderStep(
    ctx,
    'stream' as never,
    streamSetup(isSubagent, command),
    Date.now() + 60_000,
  )
  expect(result.awaitingApproval).toBe(true)
  expect(approvalSessions).toEqual([isSubagent ? 'child' : 'parent'])
  return patches.flat().filter((part) => part.state === 'approval-requested')
}

describe('approval details are attached before requests are published', () => {
  let sidecar: Awaited<ReturnType<typeof startPathSidecar>>
  beforeAll(async () => {
    sidecar = await startPathSidecar()
    expect(
      Bun.spawnSync(['git', 'init', '--quiet', sidecar.root]).exitCode,
    ).toBe(0)
    await writeFile(path.join(sidecar.root, '.gitignore'), 'tmp\n')
    await mkdir(path.join(sidecar.root, 'tmp'))
  })
  afterAll(async () => {
    await sidecar.close()
  })

  for (const isSubagent of [false, true]) {
    test(`${isSubagent ? 'child' : 'main'} requests explain ignored paths and allow session grants`, async () => {
      const requests = await streamApproval(
        isSubagent,
        `rg -n -i --hidden --glob '!node_modules' --glob '!.git' "switch.*agent|agent.*switch|unsaved.*agent|discard changes|keep editing|save behavior|agent editor|agent settings" README.md PROJECT_ANALYSIS.md tmp docs packages tests | head -500`,
      )
      expect(requests.length).toBeGreaterThan(0)
      for (const request of requests) {
        expect(request.approvalPathStatus).toBe('paths')
        expect(request.approvalPaths).toEqual(['tmp'])
        const hold = approvalHold(
          'shell',
          request.input,
          'plan',
          request.approvalPathStatus,
        )
        expect(
          buildApprovalActions(true, null, hold).map((action) => action.id),
        ).toContain('remember-paths')
      }
      expect(sidecar.requests.at(-1)?.arguments).toMatchObject({
        sessionId: 'parent',
        workspaceId: 'workspace',
        allowedPaths: ['session-grant', 'agent-grant'],
      })
    })

    test(`${isSubagent ? 'child' : 'main'} requests preserve forbidden-path explanations`, async () => {
      const requests = await streamApproval(isSubagent, 'cat .git/config')
      expect(requests.length).toBeGreaterThan(0)
      for (const request of requests) {
        expect(request.approvalPathStatus).toBe('forbidden')
        expect(request.approvalPaths).toEqual(['.git/config'])
      }
    })
  }
})
