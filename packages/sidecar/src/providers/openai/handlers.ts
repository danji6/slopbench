import { chatGPTCacheKey, prepareChatGPTRequest } from '@sb/core/chatgpt-policy'
import type { Handler } from 'hono'
import { z } from 'zod'

import {
  continuitySchema,
  responseRoutingHeaders,
  turnRoutingHeaders,
} from './continuity'
import { cancelSignIn, connectionStatus, startSignIn } from './oauth'
import type { ConnectionKey } from './storage'
import { requireCompletedStream } from './stream'
import { accessContext, accessToken, disconnect } from './tokens'

const keySchema = z.object({
  ownerId: z.string().min(1),
  connectionId: z.string().min(1),
})

const active = new Map<string, Set<AbortController>>()

function keyId(key: ConnectionKey) {
  return JSON.stringify([key.ownerId, key.connectionId])
}

export const startChatGPTSignIn: Handler = async (c) =>
  c.json(await startSignIn(keySchema.parse(await c.req.json())))

export const chatGPTStatus: Handler = async (c) =>
  c.json(await connectionStatus(keySchema.parse(await c.req.json())))

export const cancelChatGPTSignIn: Handler = async (c) => {
  cancelSignIn(keySchema.parse(await c.req.json()))
  return c.json({ ok: true })
}

export const disconnectChatGPT: Handler = async (c) => {
  const key = keySchema.parse(await c.req.json())
  cancelSignIn(key)
  for (const controller of active.get(keyId(key)) ?? []) controller.abort()
  return c.json(await disconnect(key))
}

export const chatGPTModels: Handler = async (c) => {
  const key = keySchema.parse(await c.req.json())
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${await accessToken(key)}` },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    return c.json(
      {
        error: `ChatGPT catalog request failed (HTTP ${response.status}). Reconnect or retry.`,
      },
      502,
    )
  return new Response(response.body, {
    headers: { 'Content-Type': 'application/json' },
  })
}

export const chatGPTResponses: Handler = async (c) => {
  const input = keySchema
    .extend({
      body: z.record(z.string(), z.unknown()),
      continuity: continuitySchema.optional(),
    })
    .parse(await c.req.json())
  const body = prepareChatGPTRequest(input.body)
  const cacheKey = chatGPTCacheKey(body)
  const id = keyId(input)
  const controller = new AbortController()
  const controllers = active.get(id) ?? new Set<AbortController>()

  controllers.add(controller)
  active.set(id, controllers)

  const release = () => {
    controllers.delete(controller)
    if (!controllers.size) active.delete(id)
  }

  try {
    const { token, authRevision } = await accessContext(input)
    const routing = turnRoutingHeaders(input.continuity, authRevision)

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...routing.headers,
        ...(cacheKey === undefined ? {} : { 'session-id': cacheKey }),
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, c.req.raw.signal]),
    })

    const responseHeaders = responseRoutingHeaders(response, {
      ...routing,
      authRevision,
    })
    for (const [name, value] of responseHeaders) c.header(name, value)

    if (!response.ok) {
      release()
      const data = (await response.json().catch(() => undefined)) as
        { error?: { code?: string; message?: string } } | undefined
      const code = data?.error?.code ?? ''

      const message = code.startsWith('subscription_sharing_usage_limit')
        ? 'ChatGPT plan usage is unavailable or exhausted. Review usage in ChatGPT settings or explicitly choose another connection.'
        : (data?.error?.message?.slice(0, 1000) ??
          `ChatGPT request failed (HTTP ${response.status}). Reconnect or check model support.`)

      const status = code.startsWith('subscription_sharing_usage_limit')
        ? 422
        : response.status >= 500
          ? 502
          : 400

      return c.json(
        { error: { message, type: 'chatgpt_connection_error', code } },
        status,
      )
    }
    if (!response.body) {
      release()
      throw new Error('ChatGPT returned an empty stream')
    }
    return new Response(requireCompletedStream(response.body, release), {
      headers: new Headers([
        ...responseHeaders,
        ['Content-Type', 'text/event-stream'],
        ['Cache-Control', 'no-store'],
      ]),
    })
  } catch (err) {
    release()
    throw err
  }
}
