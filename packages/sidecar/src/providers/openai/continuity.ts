import { CHATGPT_ROUTING_HEADERS } from '@sb/core/chatgpt-routing'
import { isRoutingHeader } from '@sb/core/provider-continuity'
import { z } from 'zod'

export const continuitySchema = z.object({
  token: z.string().refine(isRoutingHeader, 'Invalid routing token'),
  authRevision: z.uuid(),
})

type Continuity = z.infer<typeof continuitySchema>

/** Forwards only state issued under the current local sign-in. */
export function turnRoutingHeaders(
  supplied: Continuity | undefined,
  authRevision: string,
) {
  const sent = supplied?.authRevision === authRevision
  const headers: Record<string, string> = sent
    ? { 'x-codex-turn-state': supplied.token }
    : {}
  return {
    headers,
    sent,
    reset: !!supplied && !sent,
  }
}

type ResponseRouting = {
  authRevision: string
  sent: boolean
  reset: boolean
}

/** Returns a small internal allowlist, never arbitrary upstream headers. */
export function responseRoutingHeaders(
  response: Response,
  routing: ResponseRouting,
) {
  const headers = new Headers({
    [CHATGPT_ROUTING_HEADERS.revision]: routing.authRevision,
    [CHATGPT_ROUTING_HEADERS.sent]: String(routing.sent),
    [CHATGPT_ROUTING_HEADERS.reset]: String(routing.reset),
    [CHATGPT_ROUTING_HEADERS.upstreamStatus]: String(response.status),
  })
  const token = response.headers.get('x-codex-turn-state')

  if (isRoutingHeader(token)) {
    headers.set(CHATGPT_ROUTING_HEADERS.token, token)
  }
  headers.set(
    CHATGPT_ROUTING_HEADERS.invalid,
    String(token !== null && !isRoutingHeader(token)),
  )
  for (const name of ['x-request-id', 'openai-model']) {
    const value = response.headers.get(name)
    if (isRoutingHeader(value)) headers.set(name, value.slice(0, 256))
  }

  return headers
}
