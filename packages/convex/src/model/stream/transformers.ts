import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { TextStreamPart, ToolSet } from 'ai'

import { generateId } from '../../lib/utils'

export function omitLargeStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return omitBinaryData(value)
  }
  if (Array.isArray(value)) return value.map(omitLargeStrings)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, omitLargeStrings(val)]),
    )
  }
  return value
}

const MIN_BASE64_BINARY_CHARS = 1024
const DATA_URL_BASE64_PATTERN =
  /(data:[^,;]+(?:;[^,;]+)*;base64,)([A-Za-z0-9+/_-]{1024,}={0,2})/g
const BASE64_BINARY_PATTERN =
  /(?<![A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{1024,}={0,2})(?![A-Za-z0-9+/_-])/g

function omitBinaryData(value: string) {
  return value
    .replace(
      DATA_URL_BASE64_PATTERN,
      (_, prefix: string, data: string) =>
        `${prefix}${formatBinaryOmission(data.length)}`,
    )
    .replace(BASE64_BINARY_PATTERN, (data: string) =>
      isLikelyBase64Binary(data) ? formatBinaryOmission(data.length) : data,
    )
}

function isLikelyBase64Binary(value: string) {
  if (value.length < MIN_BASE64_BINARY_CHARS) return false
  const padding = value.match(/=+$/)?.[0].length ?? 0
  if (padding > 2) return false

  const unpaddedLength = value.length - padding
  return unpaddedLength % 4 !== 1
}

function formatBinaryOmission(length: number) {
  return `[omitted binary data ${length} chars]`
}

export async function withProviderRequestLogging(
  languageModel: LanguageModelV3,
  onRequest: (body: string) => void | Promise<void>,
) {
  const { wrapLanguageModel } = await import('ai')
  return wrapLanguageModel({
    model: languageModel,
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params, type }) => {
        const body = JSON.stringify(
          omitLargeStrings({
            type,
            provider: languageModel.provider,
            modelId: languageModel.modelId,
            ...params,
          }),
          null,
          2,
        )
        await onRequest(body)
        return params
      },
    },
  })
}

export type StreamTracker = { hasOutput: boolean }

export const trackGeneratedOutput =
  <TOOLS extends ToolSet>(tracker: StreamTracker) =>
  (_: { tools: TOOLS }) =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (
          chunk.type === 'text-delta' ||
          chunk.type === 'reasoning-delta' ||
          chunk.type === 'tool-call' ||
          chunk.type === 'tool-result' ||
          chunk.type === 'file' ||
          chunk.type === 'source'
        ) {
          tracker.hasOutput = true
        }
        controller.enqueue(chunk)
      },
    })

export type ToolErrorTracker = { toolErrors: Set<string> }

export const trackToolErrors =
  <TOOLS extends ToolSet>(tracker: ToolErrorTracker) =>
  (_: { tools: TOOLS }) =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === 'tool-error') {
          const { toolCallId } = chunk as { toolCallId?: string }
          if (toolCallId) tracker.toolErrors.add(toolCallId)
        }
        controller.enqueue(chunk)
      },
    })

type StreamStartWarning =
  | { type: 'unsupported'; feature: string; details?: string }
  | { type: 'compatibility'; feature: string; details?: string }
  | { type: 'other'; message: string }
  | { type: 'unsupported-setting'; setting: string; details?: string }
  | { type: 'unsupported-tool'; tool: unknown; details?: string }

type StreamStartChunk = {
  type: 'stream-start'
  warnings: StreamStartWarning[]
}

type WarningChunk = {
  type: 'stream-start' | 'start-step'
  warnings: StreamStartWarning[]
}

export const normalizeUnsupportedWarnings = <TOOLS extends ToolSet>(_: {
  tools: TOOLS
}) =>
  new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
    transform(chunk, controller) {
      const warningChunk = chunk as
        TextStreamPart<TOOLS> | StreamStartChunk | WarningChunk

      if (
        warningChunk.type !== 'stream-start' &&
        warningChunk.type !== 'start-step'
      ) {
        controller.enqueue(chunk)
        return
      }

      const normalizedChunk = {
        ...warningChunk,
        warnings: warningChunk.warnings.map((warning) => {
          if (
            warning.type !== 'unsupported' &&
            warning.type !== 'compatibility'
          ) {
            return warning
          }

          return {
            type: 'unsupported-setting',
            setting: warning.feature,
            details: warning.details,
          }
        }),
      }
      controller.enqueue(normalizedChunk as unknown as TextStreamPart<TOOLS>)
    },
  })

export function formatStreamWarnings(warnings: unknown[]): string[] {
  const formatted = warnings.map(formatStreamWarning).filter(Boolean)
  return [...new Set(formatted)]
}

function formatStreamWarning(warning: unknown): string {
  if (warning == null || typeof warning !== 'object') return ''

  const value = warning as {
    type?: unknown
    setting?: unknown
    feature?: unknown
    message?: unknown
    details?: unknown
  }

  const details = typeof value.details === 'string' ? value.details : undefined
  const suffix = details ? ` ${details}` : ''

  if (
    value.type === 'unsupported-setting' &&
    typeof value.setting === 'string'
  ) {
    return `The provider does not support "${value.setting}".${suffix}`
  }

  if (
    (value.type === 'unsupported' || value.type === 'compatibility') &&
    typeof value.feature === 'string'
  ) {
    return `The provider does not support "${value.feature}".${suffix}`
  }

  if (value.type === 'other' && typeof value.message === 'string') {
    return value.message
  }

  if (typeof value.message === 'string') return value.message
  return ''
}

// Strip provider-specific metadata from stream chunks.
export const stripProviderMetadata = <TOOLS extends ToolSet>(_: {
  tools: TOOLS
}) =>
  new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
    transform(chunk, controller) {
      // Keep provider metadata on the finish chunks so we can track usage
      const keep = chunk.type === 'finish' || chunk.type === 'finish-step'
      if (!keep && 'providerMetadata' in chunk) {
        const { providerMetadata: _, ...rest } =
          chunk as TextStreamPart<TOOLS> & {
            providerMetadata?: unknown
          }
        controller.enqueue(rest as TextStreamPart<TOOLS>)
      } else {
        controller.enqueue(chunk)
      }
    },
  })

// Ensure tool call IDs are globally unique across steps.
export const deduplicateToolCallIds = <TOOLS extends ToolSet>(_: {
  tools: TOOLS
}) => {
  const seenIds = new Set<string>()
  const pendingRenames = new Map<string, string>()

  return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
    transform(chunk, controller) {
      if (chunk.type === 'tool-call') {
        const { toolCallId } = chunk as { toolCallId: string }
        if (seenIds.has(toolCallId)) {
          const newId = generateId()
          pendingRenames.set(toolCallId, newId)
          seenIds.add(newId)
          controller.enqueue({ ...chunk, toolCallId: newId })
        } else {
          seenIds.add(toolCallId)
          controller.enqueue(chunk)
        }
      } else if (chunk.type === 'tool-result') {
        const { toolCallId } = chunk as { toolCallId: string }
        const renamed = pendingRenames.get(toolCallId)
        if (renamed !== undefined) {
          pendingRenames.delete(toolCallId)
          controller.enqueue({ ...chunk, toolCallId: renamed })
        } else {
          controller.enqueue(chunk)
        }
      } else {
        controller.enqueue(chunk)
      }
    },
  })
}

// Stops enqueuing further chunks on abort
export const stopWhenInactive = (abortController: AbortController) => () =>
  new TransformStream({
    transform(chunk, controller) {
      if (abortController.signal.aborted) {
        controller.terminate()
        return
      }
      controller.enqueue(chunk)
    },
  })
