import { APP_ID } from '@sb/core/const'
import { createHash, randomBytes } from 'node:crypto'

import { type SignInAttempt, listenForAuthorization } from './loopback'
import type { PendingAuthorization } from './oauthCallback'
import {
  type ConnectionKey,
  hostId,
  readRegistration,
  withRegistrationLock,
} from './storage'
import { ISSUER, RESOURCE } from './tokens'

const attempts = new Map<string, SignInAttempt>()
const cancellations = new Map<string, AbortController>()

function keyId(key: ConnectionKey) {
  return JSON.stringify([key.ownerId, key.connectionId])
}

export function cancelSignIn(key: ConnectionKey) {
  cancellations.get(keyId(key))?.abort()
  cancellations.delete(keyId(key))
  attempts.get(keyId(key))?.cancel()
  attempts.delete(keyId(key))
}

/** Reserves an attempt before awaiting I/O so replacement and disconnect always cancel it. */
export async function startSignIn(key: ConnectionKey, targetHostId?: string) {
  cancelSignIn(key)
  const cancellation = new AbortController()
  const id = keyId(key)
  cancellations.set(id, cancellation)

  return withRegistrationLock(key, async () => {
    cancellation.signal.throwIfAborted()
    const previous = (await readRegistration(key)) ?? {
      hostId: targetHostId ?? (await hostId()),
      scopes: [],
    }
    const pending: PendingAuthorization = {
      key,
      previous,
      state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
      verifier: randomBytes(32).toString('base64url'),
      redirectUri: '',
      cancellation: cancellation.signal,
    }
    const attempt = await listenForAuthorization(pending, cancellation)
    attempts.set(id, attempt)

    setTimeout(() => {
      if (attempts.get(id) === attempt) {
        attempts.delete(id)
        cancellations.delete(id)
      }
    }, 10 * 60_000).unref()

    return { url: authorizationUrl(pending), expiresAt: attempt.expires }
  })
}

function authorizationUrl(pending: PendingAuthorization) {
  const { previous, state, nonce, verifier, redirectUri } = pending

  const query: Record<string, string> = {
    client_id: previous.clientId ?? 'dynamic_agent_client',
    ext_agent_host_id: previous.hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope:
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource: RESOURCE,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  }

  if (!previous.clientId) query.agent_name_hint = APP_ID
  // Retained ID tokens stay in the runtime; only the optional email hint reaches the UI
  if (previous.email) query.login_hint = previous.email

  const url = new URL(`${ISSUER}/api/accounts/authorize`)
  url.search = new URLSearchParams(query).toString()
  return url.toString()
}

export async function connectionStatus(key: ConnectionKey) {
  const record = await readRegistration(key)
  const attempt = attempts.get(keyId(key))
  return {
    status:
      attempt?.status === 'pending'
        ? 'pending'
        : record?.accessToken
          ? 'connected'
          : 'disconnected',
    planEnabled: record?.scopes.includes('chatgpt.tokens.use.direct') ?? false,
    email: record?.email,
    registration: record?.clientId,
    message: attempt?.message,
  }
}
