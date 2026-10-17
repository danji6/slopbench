import {
  type ConnectionKey,
  type Registration,
  readRegistration,
  saveRegistration,
  withRegistrationLock,
} from './storage'
import { exchangeToken, verifyIdentity } from './tokens'

export type PendingAuthorization = {
  key: ConnectionKey
  previous: Registration
  state: string
  nonce: string
  verifier: string
  redirectUri: string
  cancellation: AbortSignal
}

/** Exchanges a single callback after loopback state validation and preserves the selected identity. */
export async function completeAuthorization(
  pending: PendingAuthorization,
  params: URLSearchParams,
) {
  if (params.has('error')) throw new Error('Authorization declined')

  const clientId = params.get('client_id') ?? pending.previous.clientId
  if (!clientId || clientId === 'dynamic_agent_client' || !params.get('code'))
    throw new Error('Registration incomplete')
  if (pending.previous.clientId && pending.previous.clientId !== clientId)
    throw new Error('Registration mismatch')

  await withRegistrationLock(pending.key, async () => {
    pending.cancellation.throwIfAborted()
    const current = (await readRegistration(pending.key)) ?? pending.previous
    if (current.clientId && current.clientId !== clientId)
      throw new Error('Registration changed during sign-in')

    await saveRegistration(pending.key, { ...current, clientId })

    const tokens = await exchangeToken(
      {
        grant_type: 'authorization_code',
        client_id: clientId,
        code: params.get('code')!,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
      },
      { ...current, clientId },
    )
    if (!tokens.idToken) throw new Error('Missing identity token')

    const identity = await verifyIdentity(
      tokens.idToken,
      clientId,
      pending.nonce,
    )
    if (current.subject && current.subject !== identity.subject)
      throw new Error('Selected ChatGPT account changed')

    pending.cancellation.throwIfAborted()
    await saveRegistration(pending.key, { ...tokens, ...identity })
  })
}
