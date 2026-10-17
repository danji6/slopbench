import { createServer } from 'node:http'

import {
  type PendingAuthorization,
  completeAuthorization,
} from './oauthCallback'

export type SignInAttempt = {
  status: 'pending' | 'connected' | 'error'
  message?: string
  expires: number
  cancel: () => void
}

/** Accepts one matching callback on an ephemeral IPv4 loopback port. */
export async function listenForAuthorization(
  pending: PendingAuthorization,
  cancellation: AbortController,
) {
  let consumed = false
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (
      url.pathname !== '/auth/callback' ||
      url.searchParams.get('state') !== pending.state ||
      consumed
    ) {
      response.writeHead(400).end('Invalid authorization callback.')
      return
    }

    consumed = true

    void completeAuthorization(pending, url.searchParams)
      .then(() => {
        attempt.status = 'connected'
        response
          .writeHead(200, {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          })
          .end('Connected. You can close this window and return to Slopbench.')
      })
      .catch(() => {
        attempt.status = 'error'
        attempt.message = 'ChatGPT sign-in failed or was declined. Try again.'
        response
          .writeHead(400, {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
          })
          .end(attempt.message)
      })
      .finally(() => {
        clearTimeout(timer)
        server.close()
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Cannot start sign-in callback')

  pending.redirectUri = `http://127.0.0.1:${address.port}/auth/callback`

  function stop() {
    consumed = true
    clearTimeout(timer)
    server.closeAllConnections()
    server.close()
  }

  const attempt: SignInAttempt = {
    status: 'pending',
    expires: Date.now() + 5 * 60_000,
    cancel: () => {
      cancellation.abort()
      stop()
    },
  }

  const timer = setTimeout(() => {
    attempt.status = 'error'
    attempt.message = 'Sign-in timed out. Try again.'
    attempt.cancel()
  }, 5 * 60_000)
  timer.unref()

  cancellation.signal.addEventListener('abort', stop, { once: true })
  if (cancellation.signal.aborted) {
    stop()
    cancellation.signal.throwIfAborted()
  }

  return attempt
}
