import type { FetchFunction } from '@ai-sdk/provider-utils'
import { parseModelExtraParameters } from '@sb/core/model-parameters'
import { normalizeReasoningEffort } from '@sb/core/model-reasoning'
import { parseProviderExtraHeaders } from '@sb/core/provider-headers'
import type { ModelReasoning, ReasoningEffort } from '@sb/core/types'

import { omitLargeStrings } from '../stream/transformers'
import { providerReasoningField, resolveModelReasoning } from './known'
import { adaptReasoningResponse } from './response'

type RequestAdapterOptions = {
  providerId: string
  reasoning?: ModelReasoning
  reasoningEffort?: ReasoningEffort
  extraParameters?: string
  extraHeaders?: string
  fetch?: FetchFunction
  onRequest?: (body: string) => void | Promise<void>
}

export function createProviderFetch({
  providerId,
  reasoning,
  reasoningEffort,
  extraParameters,
  extraHeaders,
  fetch: baseFetch = globalThis.fetch,
  onRequest,
}: RequestAdapterOptions): FetchFunction {
  const resolvedReasoning = resolveModelReasoning(providerId, reasoning)
  const effort = normalizeReasoningEffort(reasoningEffort, resolvedReasoning)
  const extras = parseModelExtraParameters(extraParameters)
  const headers = parseProviderExtraHeaders(extraHeaders)

  const adapted = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestInit = mergeRequestHeaders(init, headers)
    if (typeof requestInit?.body !== 'string') {
      return adaptResponse(await baseFetch(input, requestInit))
    }

    let body: unknown
    try {
      body = JSON.parse(requestInit.body)
    } catch {
      return adaptResponse(await baseFetch(input, requestInit))
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return adaptResponse(await baseFetch(input, requestInit))
    }

    const reasoningPatch = reasoningBodyPatch(
      providerId,
      resolvedReasoning,
      effort,
      body as Record<string, unknown>,
    )
    const merged = { ...body, ...reasoningPatch, ...extras }
    if (onRequest) {
      await onRequest(JSON.stringify(omitLargeStrings(merged), null, 2))
    }

    return adaptResponse(
      await baseFetch(input, {
        ...requestInit,
        body: JSON.stringify(merged),
      }),
      merged.stream === true,
    )
  }

  const reasoningField = providerReasoningField(providerId)
  const adaptResponse = (response: Response, stream?: boolean) =>
    reasoningField
      ? adaptReasoningResponse(response, reasoningField, stream)
      : Promise.resolve(response)

  return adapted as FetchFunction
}

function mergeRequestHeaders(
  init: RequestInit | undefined,
  extraHeaders: Record<string, string>,
): RequestInit | undefined {
  if (Object.keys(extraHeaders).length === 0) return init
  const headers = new Headers(init?.headers)
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value)
  }
  return { ...init, headers }
}

function reasoningBodyPatch(
  providerId: string,
  reasoning: ModelReasoning,
  effort: ReasoningEffort,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (reasoning.type === 'binary') {
    return { [reasoning.parameter]: effort !== 'none' }
  }
  if (reasoning.type !== 'effort') {
    return {}
  }
  if (providerId === 'ollama') {
    if (effort === 'auto') return { think: true }
    return { think: effort === 'none' ? false : effort }
  }
  if (effort !== 'max') {
    return {}
  }

  switch (providerId) {
    case 'anthropic':
      return { output_config: { effort } }
    case 'openrouter':
      return { reasoning: { effort } }
    default:
      if ('input' in body) {
        const existing =
          body.reasoning && typeof body.reasoning === 'object'
            ? body.reasoning
            : {}
        return { reasoning: { ...existing, effort } }
      }
      return { reasoning_effort: effort }
  }
}
