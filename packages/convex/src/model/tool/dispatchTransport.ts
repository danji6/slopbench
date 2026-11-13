'use node'

import type {
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4ToolCall,
} from '@ai-sdk/provider'
import { wireToolCall } from '@cv/core/tool-dispatch'
import type { LanguageModel, LanguageModelMiddleware, UIMessage } from 'ai'

import { extractErrorMessage } from '../../errors'
import { sameDefinition } from './manifest'
import { DISPATCH_ERROR_TOOL, type SessionTools } from './sessionTools'

/** Freezes wire definitions and translates dispatch before SDK validation and lifecycle handling. */
export async function dispatchLanguageModel(
  model: LanguageModel,
  runtime: SessionTools,
) {
  if (typeof model === 'string')
    throw new Error('Dispatcher requires a resolved language model')
  const { wrapLanguageModel } = await import('ai')
  return wrapLanguageModel({ model, middleware: dispatchMiddleware(runtime) })
}

export function dispatchMiddleware(
  runtime: SessionTools,
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v4',
    transformParams: async ({ params }) => ({
      ...params,
      tools: runtime.wireDefinitions.map((definition) => ({
        type: 'function' as const,
        name: definition.name,
        description: definition.description,
        inputSchema: JSON.parse(definition.inputSchema),
      })),
      prompt: restoreWirePrompt(params.prompt, runtime),
    }),
    wrapGenerate: async ({ doGenerate }) => {
      const response = await doGenerate()
      const content = await Promise.all(
        response.content.map((part) =>
          part.type === 'tool-call' ? routeToolCall(part, runtime) : part,
        ),
      )
      return { ...response, content }
    },
    wrapStream: async ({ doStream }) => {
      const response = await doStream()
      return {
        ...response,
        stream: response.stream.pipeThrough(dispatchStream(runtime)),
      }
    },
  }
}

function dispatchStream(runtime: SessionTools) {
  const suppressed = new Set<string>()
  return new TransformStream<
    LanguageModelV4StreamPart,
    LanguageModelV4StreamPart
  >({
    async transform(chunk, controller) {
      const toolStart = chunk.type === 'tool-input-start'
      if (toolStart && needsRouting(chunk.toolName, runtime)) {
        suppressed.add(chunk.id)
        return
      }
      const inputChunk =
        chunk.type === 'tool-input-delta' || chunk.type === 'tool-input-end'
      if (inputChunk && suppressed.has(chunk.id)) return
      controller.enqueue(
        chunk.type === 'tool-call'
          ? await routeToolCall(chunk, runtime)
          : chunk,
      )
    },
  })
}

function needsRouting(name: string, runtime: SessionTools) {
  if (name === 'call_tool') return true
  if (name === 'get_tool') return false
  return !sameDefinition(
    runtime.frozen.definitions?.find((entry) => entry.name === name),
    runtime.current.definitions?.find((entry) => entry.name === name),
  )
}

async function routeToolCall(
  call: LanguageModelV4ToolCall,
  runtime: SessionTools,
) {
  let input: unknown
  try {
    input = JSON.parse(call.input)
    if (call.toolName === 'get_tool') return call
    const target = resolveTarget(call, input, runtime)
    if (call.toolName === 'call_tool') {
      runtime.wireCalls.set(call.toolCallId, { name: call.toolName, input })
    }
    await runtime.assertAccess(target.toolName)
    return target
  } catch (cause) {
    runtime.wireCalls.set(call.toolCallId, {
      name: call.toolName,
      input: input ?? call.input,
    })
    return {
      ...call,
      toolName: DISPATCH_ERROR_TOOL,
      input: JSON.stringify({ error: extractErrorMessage(cause) }),
    }
  }
}

function resolveTarget(
  call: LanguageModelV4ToolCall,
  input: unknown,
  runtime: SessionTools,
) {
  if (call.toolName !== 'call_tool') {
    if (needsRouting(call.toolName, runtime)) {
      throw new Error(
        'Native tool is unavailable or changed; use get_tool and call_tool',
      )
    }
    return call
  }

  const dispatch = input as { name?: unknown; arguments?: unknown } | null
  if (!dispatch || typeof dispatch.name !== 'string')
    throw new Error('Dispatcher requires a tool name')

  const argumentsObject =
    dispatch.arguments &&
    typeof dispatch.arguments === 'object' &&
    !Array.isArray(dispatch.arguments)
  if (!argumentsObject)
    throw new Error('Dispatcher arguments must be an object')

  if (!runtime.current.names.includes(dispatch.name))
    throw new Error('Unknown or disabled tool')

  return {
    ...call,
    toolName: dispatch.name,
    input: JSON.stringify(dispatch.arguments),
  }
}

/** Stores logical target parts so all existing approval and UI handlers share one lifecycle. */
export function attachWireCalls(
  parts: UIMessage['parts'],
  runtime: SessionTools,
): UIMessage['parts'] {
  return parts.map((part) => {
    const id = (part as { toolCallId?: string }).toolCallId
    const wireCall = id ? runtime.wireCalls.get(id) : undefined
    if (!wireCall) return part
    if (part.type === `tool-${DISPATCH_ERROR_TOOL}`) {
      return {
        ...part,
        type: `tool-${wireCall.name}`,
        input: wireCall.input,
        wireCall,
      }
    }
    return { ...part, wireCall }
  }) as UIMessage['parts']
}

/** Remembers envelopes before replay conversion or approval resumption. */
export function rememberWireCalls(
  parts: readonly unknown[],
  runtime: SessionTools,
) {
  for (const part of parts) {
    const id = (part as { toolCallId?: string })?.toolCallId
    const wire = wireToolCall(part)
    if (id && wire) runtime.wireCalls.set(id, wire)
  }
}

/** Restores provider names after the SDK has executed approved logical tool calls. */
export function restoreWirePrompt(
  prompt: LanguageModelV4Prompt,
  runtime: SessionTools,
): LanguageModelV4Prompt {
  return prompt.map((message) => {
    if (message.role !== 'assistant' && message.role !== 'tool') return message
    const content = message.content.map((part) => {
      if (part.type !== 'tool-call' && part.type !== 'tool-result') return part
      const wire = runtime.wireCalls.get(part.toolCallId)
      if (!wire) return part
      return part.type === 'tool-call'
        ? { ...part, toolName: wire.name, input: wire.input }
        : { ...part, toolName: wire.name }
    })
    return { ...message, content } as typeof message
  })
}
