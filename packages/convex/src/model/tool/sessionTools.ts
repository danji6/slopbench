'use node'

import type { WireToolCall } from '@sb/core/tool-dispatch'
import { TOOL_DESCRIPTIONS } from '@sb/core/types/tool-descriptions'
import type { ToolExecutionOptions, ToolSet } from 'ai'

import { internal } from '../../_generated/api'
import type { ActionCtx } from '../../_generated/server'
import { ToolError } from '../../errors'
import { generateId } from '../../lib/utils'
import type { StreamContext } from '../../types'
import {
  compactDefinitions,
  frozenDefinitions,
  toolDefinitions,
} from './definitions'
import type { ToolDefinition, ToolManifest } from './manifest'
import { guardMcpApproval } from './mcpApproval'

export const DISPATCH_ERROR_TOOL = '__sb_tool_error'

export type SessionTools = {
  wireDefinitions: ToolDefinition[]
  frozen: ToolManifest
  current: ToolManifest
  tools: ToolSet
  wireCalls: Map<string, WireToolCall>
  assertAccess: (name: string) => Promise<void>
}

type ToolPreparation = {
  ctx: ActionCtx
  data: StreamContext
  manifest: ToolManifest
  wireCalls: SessionTools['wireCalls']
}

/** Builds live execution policies while capturing provider definitions only once. */
export async function prepareSessionTools(
  ctx: ActionCtx,
  data: StreamContext,
  manifest: ToolManifest,
): Promise<SessionTools> {
  const wireCalls = new Map<string, WireToolCall>()

  const tools = await currentTools({ ctx, data, manifest, wireCalls })
  const definitions = await toolDefinitions(tools)

  const current = {
    ...manifest,
    definitions: compactDefinitions(manifest, definitions),
  }

  const assertAccess = accessAssertion(ctx, data, current)

  const helpers = await createDispatcherTools(
    { ...current, definitions },
    assertAccess,
  )

  const frozen =
    data.sessionCache?.tools ??
    (await captureManifest(manifest, definitions, helpers))

  const wireDefinitions = await frozenDefinitions(ctx, frozen, {
    streamId: data.stream._id,
    generation: data.stream.generation,
  })

  const executable = await executionTools(
    { ...tools, ...helpers },
    wireDefinitions,
    assertAccess,
  )

  return {
    wireDefinitions,
    frozen,
    current,
    assertAccess,
    wireCalls,
    tools: executable,
  }
}

async function currentTools({
  ctx,
  data,
  manifest,
  wireCalls,
}: ToolPreparation) {
  const { getEnabledTools } = await import('./build')
  return getEnabledTools(
    manifest,
    { ...data.session, toolApprovals: data.toolApprovals },
    { settings: data.settings, mcpServers: data.mcpServers },
    {
      ctx,
      wireCalls,
      autoApprove: data.agent.autoApprove,
      omitMcpMedia: data.stream.omitActiveMedia,
      messageId: data.output._id,
      messageCreatedAt: data.output._creationTime,
      agentId: data.agent._id,
      invokedBy: data.stream.invokedBy,
      execution: {
        streamId: data.stream._id,
        generation: data.stream.generation,
      },
    },
  )
}

function accessAssertion(
  ctx: ActionCtx,
  data: StreamContext,
  manifest: ToolManifest,
): SessionTools['assertAccess'] {
  return async (name) => {
    await ctx.runQuery(internal.streams._assertToolAccess, {
      streamId: data.stream._id,
      generation: data.stream.generation,
      name,
      manifest,
    })
  }
}

async function captureManifest(
  manifest: ToolManifest,
  definitions: ToolDefinition[],
  helpers: ToolSet,
): Promise<ToolManifest> {
  return {
    ...manifest,
    contextId: generateId(),
    names: [...manifest.names, ...Object.keys(helpers)],
    definitions: compactDefinitions(manifest, [
      ...definitions,
      ...(await toolDefinitions(helpers)),
    ]),
  }
}

async function executionTools(
  tools: ToolSet,
  definitions: ToolDefinition[],
  assertAccess: SessionTools['assertAccess'],
) {
  const { tool, jsonSchema } = await import('ai')

  const current = Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      name === 'get_tool' || name === 'call_tool'
        ? definition
        : guardToolAccess(name, definition, assertAccess),
    ]),
  )

  for (const definition of definitions) {
    if (Object.hasOwn(current, definition.name)) continue
    current[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(JSON.parse(definition.inputSchema)),
      execute: async (): Promise<unknown> => {
        throw new ToolError('Tool is no longer enabled')
      },
    })
  }

  current[DISPATCH_ERROR_TOOL] = tool({
    inputSchema: jsonSchema<{ error: string }>({
      type: 'object',
      properties: { error: { type: 'string' } },
      required: ['error'],
    }),
    execute: async ({ error }): Promise<unknown> => {
      throw new ToolError(error)
    },
  })

  return current
}

/** Provides stable transport schemas without enabling any targets. */
export async function createDispatcherTools(
  manifest: ToolManifest,
  assertAccess: SessionTools['assertAccess'],
) {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])

  return {
    get_tool: tool({
      description: TOOL_DESCRIPTIONS.get_tool,
      inputSchema: z.object({ name: z.string().min(1).max(1024) }),
      execute: async ({ name }) => inspectTool(manifest, assertAccess, name),
    }),
    call_tool: tool({
      description: TOOL_DESCRIPTIONS.call_tool,
      inputSchema: z.object({
        name: z.string().min(1).max(1024),
        arguments: z.object({}).catchall(z.unknown()),
      }),
      execute: async (): Promise<unknown> => {
        throw new ToolError(
          'Invalid dispatcher call; get_tool before calling a target',
        )
      },
    }),
  }
}

async function inspectTool(
  manifest: ToolManifest,
  assertAccess: SessionTools['assertAccess'],
  name: string,
) {
  const definition = manifest.definitions?.find((entry) => entry.name === name)
  if (!definition) throw new ToolError('Unknown or disabled tool')
  await assertAccess(name)
  // Convex reserves $-prefixed object keys, including JSON Schema's $defs.
  return JSON.stringify({
    ...definition,
    inputSchema: JSON.parse(definition.inputSchema),
  })
}

/** Rechecks authorization after suspension while retaining synchronous streaming iterables. */
function guardToolAccess(
  name: string,
  definition: ToolSet[string],
  assertAccess: SessionTools['assertAccess'],
): ToolSet[string] {
  const { execute, needsApproval } = definition
  if (!execute) return definition
  const gate = async (
    input: unknown,
    options: ToolExecutionOptions<unknown>,
  ) => {
    await assertAccess(name)
    return typeof needsApproval === 'function'
      ? needsApproval(input, options)
      : !!needsApproval
  }
  const guarded: typeof execute =
    name === 'shell' || name === 'shell_output'
      ? async function* (input, options) {
          await assertAccess(name)
          yield* execute(input, options) as AsyncIterable<unknown>
        }
      : async (input, options) => {
          await assertAccess(name)
          return execute(input, options)
        }
  return guardMcpApproval({
    ...definition,
    needsApproval: gate,
    execute: guarded,
  })
}
