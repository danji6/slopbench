import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'

import {
  type ConnectionKey,
  type Registration,
  readRegistration,
  saveRegistration,
  withRegistrationLock,
} from './storage'

export const ISSUER = 'https://auth.openai.com'
export const RESOURCE = 'https://api.openai.com/v1'

const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string().optional(),
  scope: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number().positive(),
  earliest_refresh_at: z.number().optional(),
})

const metadataSchema = z.object({
  issuer: z.literal(ISSUER),
  jwks_uri: z.url(),
  revocation_endpoint: z.url(),
})

let metadata: Promise<z.infer<typeof metadataSchema>> | undefined

export function authMetadata() {
  metadata ??= fetch(`${ISSUER}/.well-known/openid-configuration`, {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
    .then(async (response) => {
      if (!response.ok)
        throw new Error('Cannot load OpenAI authentication metadata')
      const value = metadataSchema.parse(await response.json())
      for (const url of [value.jwks_uri, value.revocation_endpoint]) {
        if (new URL(url).origin !== ISSUER)
          throw new Error('Invalid OpenAI authentication metadata')
      }
      return value
    })
    .catch((err) => {
      metadata = undefined
      throw err
    })
  return metadata
}

export async function verifyIdentity(
  token: string,
  clientId: string,
  nonce?: string,
) {
  const config = await authMetadata()
  const { payload } = await jwtVerify(
    token,
    createRemoteJWKSet(new URL(config.jwks_uri)),
    {
      issuer: ISSUER,
      audience: clientId,
      requiredClaims: ['sub', 'exp', 'iat'],
    },
  )
  if (!payload.sub || (nonce !== undefined && payload.nonce !== nonce))
    throw new Error('ChatGPT identity validation failed')
  return {
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  }
}

export async function exchangeToken(
  form: Record<string, string>,
  previous: Registration,
): Promise<Registration> {
  const response = await fetch(`${ISSUER}/api/accounts/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, resource: RESOURCE }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    // Provider responses may contain credentials, never include them in errors
    throw new TokenGrantError(
      response.status === 400 || response.status === 401,
    )
  }

  const tokens = tokenSchema.parse(await response.json())

  return {
    ...previous,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token ?? previous.idToken,
    scopes: tokens.scope.split(/\s+/),
    expiresAt: Date.now() + tokens.expires_in * 1000,
    earliestRefreshAt: tokens.earliest_refresh_at
      ? tokens.earliest_refresh_at * 1000
      : undefined,
  }
}

class TokenGrantError extends Error {
  constructor(readonly reconnect: boolean) {
    super(
      reconnect
        ? 'ChatGPT session expired or was revoked. Reconnect in provider settings.'
        : 'ChatGPT token renewal failed, retry shortly.',
    )
  }
}

export async function accessToken(key: ConnectionKey): Promise<string> {
  return withRegistrationLock(key, async () => {
    let record = await readRegistration(key)

    if (!record?.accessToken || !record.clientId) {
      throw new Error(
        'Continue with ChatGPT in provider settings before using this connection.',
      )
    }
    if ((record.expiresAt ?? 0) - Date.now() < 60_000) {
      record = await renewRegistration(key, record)
    }
    if (!record.scopes.includes('chatgpt.tokens.use.direct')) {
      throw new Error(
        'ChatGPT plan permission is disabled. Reconnect and grant plan access.',
      )
    }

    return record.accessToken!
  })
}

async function renewRegistration(key: ConnectionKey, record: Registration) {
  if (!record.refreshToken || !record.clientId)
    throw new Error('ChatGPT session expired. Reconnect in provider settings.')
  if (record.earliestRefreshAt && record.earliestRefreshAt > Date.now())
    throw new Error('ChatGPT token cannot be renewed yet. Retry shortly.')

  let renewed: Registration
  try {
    renewed = await exchangeToken(
      {
        grant_type: 'refresh_token',
        client_id: record.clientId,
        refresh_token: record.refreshToken,
      },
      record,
    )
  } catch (err) {
    if (err instanceof TokenGrantError && err.reconnect)
      await saveRegistration(key, signedOutRegistration(record))
    throw err
  }

  if (renewed.idToken && renewed.idToken !== record.idToken) {
    const identity = await verifyIdentity(renewed.idToken, record.clientId)
    if (identity.subject !== record.subject)
      throw new Error(
        'ChatGPT identity changed during token renewal. Reconnect in provider settings.',
      )
  }

  await saveRegistration(key, renewed)
  return renewed
}

function signedOutRegistration(record: Registration): Registration {
  return {
    hostId: record.hostId,
    clientId: record.clientId,
    subject: record.subject,
    email: record.email,
    scopes: [],
  }
}

export async function disconnect(key: ConnectionKey) {
  return withRegistrationLock(key, async () => {
    const record = await readRegistration(key)
    if (!record) return { revoked: true }
    let revoked = !record.refreshToken
    try {
      if (record.refreshToken && record.clientId) {
        const config = await authMetadata()
        const response = await fetch(config.revocation_endpoint, {
          method: 'POST',
          body: new URLSearchParams({
            token: record.refreshToken,
            token_type_hint: 'refresh_token',
            client_id: record.clientId,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        })
        revoked = response.status === 200
      }
    } catch {
      /* Local sign-out must still complete. */
    }
    await saveRegistration(key, signedOutRegistration(record))
    return { revoked }
  })
}
