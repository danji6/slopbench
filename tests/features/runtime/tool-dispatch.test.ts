import { hasPendingTaskParts } from '@cv/convex/lib/subagent'
import { createAskTool } from '@cv/convex/model/tool/ask'
import { toolDefinitions } from '@cv/convex/model/tool/definitions'
import {
  attachWireCalls,
  dispatchLanguageModel,
  rememberWireCalls,
} from '@cv/convex/model/tool/dispatchTransport'
import { guardMcpApproval } from '@cv/convex/model/tool/mcpApproval'
import {
  DISPATCH_ERROR_TOOL,
  type SessionTools,
  createDispatcherTools,
} from '@cv/convex/model/tool/sessionTools'
import { shellApprovalPolicy } from '@cv/convex/model/tool/shellApproval'
import { createTaskTool } from '@cv/convex/model/tool/task'
import { hasPendingQuestions } from '@cv/core/utils/ask'
import {
  type ToolSet,
  type UIMessage,
  convertToModelMessages,
  readUIMessageStream,
  streamText,
  toUIMessageStream,
  tool,
} from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { expect, test } from 'bun:test'
import { z } from 'zod'

async function runtimeFor(targets: ToolSet) {
  const current = {
    names: Object.keys(targets),
    definitions: await toolDefinitions(targets),
  }
  const helpers = await createDispatcherTools(current, async () => {})
  const definitions = await toolDefinitions(helpers)
  return {
    current,
    frozen: { contextId: 'context', names: Object.keys(helpers), definitions },
    wireDefinitions: definitions,
    tools: {
      ...targets,
      ...helpers,
      [DISPATCH_ERROR_TOOL]: tool({
        inputSchema: z.object({ error: z.string() }),
        execute: async ({ error }): Promise<unknown> => {
          throw new Error(error)
        },
      }),
    },
    wireCalls: new Map(),
    assertAccess: async () => {},
  } satisfies SessionTools
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

async function run(
  runtime: SessionTools,
  name: string,
  input: unknown,
  initial?: UIMessage,
) {
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          if (!initial) {
            controller.enqueue({
              type: 'tool-input-start',
              id: 'call',
              toolName: name,
            })
            controller.enqueue({
              type: 'tool-input-delta',
              id: 'call',
              delta: JSON.stringify(input),
            })
            controller.enqueue({ type: 'tool-input-end', id: 'call' })
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'call',
              toolName: name,
              input: JSON.stringify(input),
            })
          }
          controller.enqueue({
            type: 'finish',
            finishReason: {
              unified: initial ? 'stop' : 'tool-calls',
              raw: undefined,
            },
            usage,
          })
          controller.close()
        },
      }),
    }),
  })
  if (initial) rememberWireCalls(initial.parts, runtime)
  const result = streamText({
    model: await dispatchLanguageModel(model, runtime),
    messages: initial
      ? await convertToModelMessages([initial], { tools: runtime.tools })
      : [{ role: 'user', content: 'Do the work' }],
    tools: runtime.tools,
    toolApproval: shellApprovalPolicy(runtime.tools),
    maxRetries: 0,
  })
  const snapshots: UIMessage[] = []
  for await (const message of readUIMessageStream({
    message: initial,
    stream: toUIMessageStream({
      stream: result.stream,
      tools: runtime.tools,
      onError: String,
    }),
    terminateOnError: true,
  })) {
    snapshots.push({
      ...message,
      parts: attachWireCalls(message.parts, runtime),
    })
  }
  return {
    message: snapshots.at(-1)!,
    snapshots,
    request: model.doStreamCalls[0]!,
  }
}

test('dispatch keeps questions and task calls pending under their logical tool identities', async () => {
  const runtime = await runtimeFor({
    ask: await createAskTool(),
    task: await createTaskTool('- Explore'),
  })
  const input = {
    questions: [
      { question: 'Choose', options: [{ label: 'A' }, { label: 'B' }] },
    ],
  }
  const asked = await run(runtime, 'call_tool', {
    name: 'ask',
    arguments: input,
  })
  expect(hasPendingQuestions(asked.message.parts)).toBe(true)
  expect(asked.message.parts).toContainEqual(
    expect.objectContaining({
      type: 'tool-ask',
      input,
      wireCall: { name: 'call_tool', input: { name: 'ask', arguments: input } },
    }),
  )
  const delegated = await run(
    await runtimeFor({ task: await createTaskTool('- Explore') }),
    'call_tool',
    {
      name: 'task',
      arguments: { agent_name: 'Explore', prompt: 'Inspect code' },
    },
  )
  expect(hasPendingTaskParts(delegated.message.parts)).toBe(true)
  expect(asked.request.tools?.map((entry) => entry.name)).toEqual([
    'get_tool',
    'call_tool',
  ])
})

test('dispatched shell calls stream outputs and replay the original dispatcher envelope', async () => {
  const shell = guardMcpApproval(
    tool({
      inputSchema: z.object({
        command: z.string(),
        description: z.string().optional(),
      }),
      needsApproval: async () => false,
      execute: async function* () {
        yield { status: 'running', text: 'Working' }
        yield { status: 'completed', text: 'Done' }
      },
    }),
  )
  const runtime = await runtimeFor({ shell })
  const args = { command: 'pwd' }
  const first = await run(runtime, 'call_tool', {
    name: 'shell',
    arguments: args,
  })
  expect(
    first.snapshots.some((message) =>
      JSON.stringify(message.parts).includes('Working'),
    ),
  ).toBe(true)
  const part = first.message.parts.find((entry) => entry.type === 'tool-shell')
  expect(part).toMatchObject({
    state: 'output-available',
    output: { text: 'Done' },
  })
  const replay = await run(runtime, '', {}, first.message)
  const call = replay.request.prompt
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.content)
    .find((part) => part.type === 'tool-call')
  expect(call).toMatchObject({
    toolName: 'call_tool',
    input: { name: 'shell', arguments: args },
  })
})

test('dispatcher retains shell approval policy, approval resume, and revocation after approval', async () => {
  let executed = 0
  const runtime = await runtimeFor({
    shell: tool({
      inputSchema: z.object({
        command: z.string(),
        description: z.string().optional(),
      }),
      needsApproval: true,
      execute: async () => {
        executed++
        return 'Done'
      },
    }),
  })
  const denied = await run(runtime, 'call_tool', {
    name: 'shell',
    arguments: { command: 'pwd' },
  })
  expect(denied.message.parts).toContainEqual(
    expect.objectContaining({ type: 'tool-shell', state: 'output-denied' }),
  )
  expect(executed).toBe(0)
  const requested = await run(runtime, 'call_tool', {
    name: 'shell',
    arguments: { command: 'pwd', description: 'Inspect location' },
  })
  const parts = requested.message.parts.map((part) =>
    part.type === 'tool-shell'
      ? {
          ...part,
          state: 'approval-responded',
          approval: {
            ...(part as { approval: object }).approval,
            approved: true,
          },
        }
      : part,
  )
  const resumed = await run(runtime, '', {}, {
    ...requested.message,
    parts,
  } as UIMessage)
  expect(executed).toBe(1)
  expect(
    resumed.request.prompt
      .filter((message) => message.role === 'tool')
      .flatMap((message) => message.content),
  ).toContainEqual(
    expect.objectContaining({ type: 'tool-result', toolName: 'call_tool' }),
  )
  runtime.assertAccess = async () => {
    throw new Error('Revoked')
  }
  const revoked = await run(runtime, 'call_tool', {
    name: 'shell',
    arguments: { command: 'pwd', description: 'Inspect location' },
  })
  expect(revoked.message.parts).toContainEqual(
    expect.objectContaining({ state: 'output-error' }),
  )
  expect(executed).toBe(1)
})

test('changed native contracts and unknown or recursive dispatches return tool errors', async () => {
  let executed = 0
  const runtime = await runtimeFor({
    work: tool({
      description: 'New contract',
      inputSchema: z.object({ value: z.string() }),
      execute: async () => {
        executed++
        return 'Done'
      },
    }),
  })
  runtime.frozen.definitions.push({
    name: 'work',
    description: 'Old contract',
    inputSchema: '{"type":"object"}',
  })
  runtime.wireDefinitions = runtime.frozen.definitions
  const changed = await run(runtime, 'work', { value: 'x' })
  expect(changed.message.parts).toContainEqual(
    expect.objectContaining({ type: 'tool-work', state: 'output-error' }),
  )
  for (const name of ['unknown', 'call_tool', 'get_tool', '__cv_tool_error']) {
    const invalid = await run(runtime, 'call_tool', { name, arguments: {} })
    expect(invalid.message.parts).toContainEqual(
      expect.objectContaining({ state: 'output-error' }),
    )
  }
  expect(executed).toBe(0)
  const dispatched = await run(runtime, 'call_tool', {
    name: 'work',
    arguments: { value: 'x' },
  })
  expect(dispatched.message.parts).toContainEqual(
    expect.objectContaining({ type: 'tool-work', state: 'output-available' }),
  )
  expect(executed).toBe(1)
})

test('tool inspection preserves JSON Schema references in a Convex-safe result', async () => {
  const { jsonSchema } = await import('ai')
  const { convexToJson } = await import('convex/values')
  const schema = {
    type: 'object' as const,
    properties: { value: { $ref: '#/$defs/value' } },
    $defs: { value: { type: 'string' as const } },
  }
  const runtime = await runtimeFor({
    work: tool({
      description: 'Work',
      inputSchema: jsonSchema(schema),
      execute: async () => 'Done',
    }),
  })
  const result = await runtime.tools.get_tool.execute!(
    { name: 'work' },
    {} as never,
  )
  expect(JSON.parse(result as string)).toMatchObject({
    name: 'work',
    inputSchema: schema,
  })
  expect(() => convexToJson(result as string)).not.toThrow()
})
