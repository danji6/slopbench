import { prepareChatGPTRequest } from '@sb/core/chatgpt-policy'
import { Hono } from 'hono'
import { z } from 'zod'

import { cancelSignIn, connectionStatus, startSignIn } from './oauth'
import { hostId } from './storage'
import type { ConnectionKey } from './storage'
import { accessToken, disconnect } from './tokens'
import { prepareTransfer } from './transfer'

const keySchema = z.object({
  ownerId: z.string().min(1),
  connectionId: z.string().min(1),
})

const active = new Map<string, Set<AbortController>>()

function keyId(key: ConnectionKey) {
  return JSON.stringify([key.ownerId, key.connectionId])
}

export const providerRoutes = new Hono()

providerRoutes.post('/prepare-transfer', async (c) =>
  c.json(await prepareTransfer(keySchema.parse(await c.req.json()))),
)

providerRoutes.post('/start', async (c) =>
  c.json(await startSignIn(keySchema.parse(await c.req.json()))),
)

providerRoutes.post('/status', async (c) =>
  c.json(await connectionStatus(keySchema.parse(await c.req.json()))),
)

providerRoutes.post('/cancel', async (c) => {
  cancelSignIn(keySchema.parse(await c.req.json()))
  return c.json({ ok: true })
})

providerRoutes.post('/host', async (c) => c.json({ hostId: await hostId() }))

providerRoutes.post('/disconnect', async (c) => {
  const key = keySchema.parse(await c.req.json())
  cancelSignIn(key)
  for (const controller of active.get(keyId(key)) ?? []) controller.abort()
  return c.json(await disconnect(key))
})

providerRoutes.post('/models', async (c) => {
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
})

providerRoutes.post('/responses', async (c) => {
  const input = keySchema
    .extend({ body: z.record(z.string(), z.unknown()) })
    .parse(await c.req.json())
  const body = prepareChatGPTRequest(input.body)
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
    const token = await accessToken(input)

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, c.req.raw.signal]),
    })

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
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    release()
    throw err
  }
})

/** Fails truncated and incomplete streams even when text was already received. */
export function requireCompletedStream(
  body: ReadableStream<Uint8Array>,
  release: () => void = () => {},
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let completed = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          release()
          if (!completed) {
            controller.error(
              new Error('ChatGPT stream ended without response.completed'),
            )
            return
          }
          controller.close()
          return
        }

        pending += decoder.decode(next.value, { stream: true })
        let separator: RegExpExecArray | null

        while ((separator = /\r?\n\r?\n/.exec(pending))) {
          const frame = pending.slice(0, separator.index)
          pending = pending.slice(separator.index + separator[0].length)

          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (!data || data === '[DONE]') continue

          const event = JSON.parse(data) as {
            type?: string
            response?: { error?: { code?: string; message?: string } }
          }

          if (
            event.type === 'response.failed' ||
            event.type === 'response.incomplete' ||
            event.type === 'error'
          ) {
            throw new Error(
              event.response?.error?.code?.startsWith(
                'subscription_sharing_usage_limit',
              )
                ? 'ChatGPT plan usage limit reached. Review usage in ChatGPT settings.'
                : 'ChatGPT could not complete this response. Retry or check provider settings.',
            )
          }
          if (event.type === 'response.completed') completed = true
        }
        if (pending.length > 4_000_000)
          throw new Error('ChatGPT stream event exceeded the size limit')
        controller.enqueue(next.value)
      } catch (err) {
        release()
        await reader.cancel().catch(() => {})
        controller.error(err)
      }
    },
    async cancel(reason) {
      release()
      await reader.cancel(reason)
    },
  })
}

// Return concise diagnostics without leaking tokens or callback parameters through I/O logs.
providerRoutes.onError((err, c) =>
  c.json(
    {
      error:
        err instanceof z.ZodError ? 'Invalid provider request' : err.message,
    },
    400,
  ),
)
