import { CHATGPT_ROUTING_HEADERS } from '@cv/core/chatgpt-routing'
import {
  type ProviderRequestContext,
  type ProviderResponseMetadata,
  isRoutingHeader,
} from '@cv/core/provider-continuity'

/** Captures routing before SSE consumption and hides internal headers from SDK logs. */
export async function fetchChatGPTResponse(
  url: string,
  init: RequestInit,
  context?: ProviderRequestContext,
) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    await context?.onError?.().catch(() => {})
    throw error
  }
  try {
    await context?.onResponse?.(readResponseMetadata(response))
  } catch (error) {
    await response.body?.cancel().catch(() => {})
    throw error
  }
  const headers = new Headers(response.headers)
  for (const name of Object.values(CHATGPT_ROUTING_HEADERS))
    headers.delete(name)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function readResponseMetadata(response: Response): ProviderResponseMetadata {
  const token = response.headers.get(CHATGPT_ROUTING_HEADERS.token)
  const authRevision = response.headers.get(CHATGPT_ROUTING_HEADERS.revision)
  return {
    continuity:
      isRoutingHeader(token) && isRoutingHeader(authRevision)
        ? { token, authRevision }
        : undefined,
    continuitySent:
      response.headers.get(CHATGPT_ROUTING_HEADERS.sent) === 'true',
    continuityReset:
      response.headers.get(CHATGPT_ROUTING_HEADERS.reset) === 'true',
    invalidContinuity:
      response.headers.get(CHATGPT_ROUTING_HEADERS.invalid) === 'true',
    requestId: response.headers.get('x-request-id')?.slice(0, 256),
    model: response.headers.get('openai-model')?.slice(0, 256),
    status: upstreamStatus(response),
  }
}

function upstreamStatus(response: Response) {
  const value = Number(
    response.headers.get(CHATGPT_ROUTING_HEADERS.upstreamStatus),
  )
  return Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : response.status
}
