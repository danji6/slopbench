import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import {
  type ConnectionKey,
  type Registration,
  hostId,
  readRegistration,
  registrationSchema,
  saveRegistration,
  withRegistrationLock,
} from './storage'
import { verifyIdentity } from './tokens'

export const setupSchema = z.object({
  ownerId: z.string(),
  connectionId: z.string(),
  hostId: z.string(),
  nonce: z.string(),
  expiresAt: z.number(),
  registration: registrationSchema,
})

export const transferSchema = z.object({
  setup: setupSchema,
  registration: registrationSchema,
})

type TransferSetup = z.infer<typeof setupSchema>
type TransferCredentials = Registration &
  Required<
    Pick<Registration, 'clientId' | 'idToken' | 'accessToken' | 'refreshToken'>
  >

/** Creates an expiring import ticket containing registration metadata but no tokens. */
export async function prepareTransfer(key: ConnectionKey) {
  const localHostId = await hostId()
  return withRegistrationLock(key, async () => {
    const record = (await readRegistration(key)) ?? {
      hostId: localHostId,
      scopes: [],
    }
    const nonce = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + 15 * 60_000
    await saveRegistration(key, {
      ...record,
      transferNonce: nonce,
      transferExpiresAt: expiresAt,
    })
    return {
      ...key,
      hostId: record.hostId,
      nonce,
      expiresAt,
      registration: {
        hostId: record.hostId,
        clientId: record.clientId,
        subject: record.subject,
        email: record.email,
        scopes: [],
      },
    }
  })
}

/** Imports only the registration prepared for this host and owner connection. */
export async function importTransfer(value: unknown) {
  const transfer = transferSchema.parse(value)
  const key = {
    ownerId: transfer.setup.ownerId,
    connectionId: transfer.setup.connectionId,
  }
  const { registration: record, setup } = transfer

  await withRegistrationLock(key, async () => {
    const pending = requireTransferTicket(await readRegistration(key), setup)
    if (record.hostId !== pending.hostId || setup.hostId !== pending.hostId) {
      throw new Error('Remote host identifier does not match')
    }
    if (pending.clientId && pending.clientId !== record.clientId) {
      throw new Error('Registration does not match the selected connection')
    }
    requireTransferCredentials(record)

    const identity = await verifyIdentity(record.idToken, record.clientId)
    if (identity.subject !== record.subject) {
      throw new Error('Transferred ChatGPT identity does not match')
    }
    if (pending.subject && pending.subject !== identity.subject) {
      throw new Error('Transferred ChatGPT identity does not match')
    }

    await saveRegistration(key, {
      ...record,
      transferNonce: undefined,
      transferExpiresAt: undefined,
    })
  })
}

/** Rejects missing, replaced, and expired tickets before accepting a transfer. */
function requireTransferTicket(
  pending: Registration | undefined,
  setup: TransferSetup,
) {
  const message =
    'Remote setup ticket expired or does not match this connection'
  if (!pending) throw new Error(message)
  if (pending.transferNonce !== setup.nonce) throw new Error(message)
  if ((pending.transferExpiresAt ?? 0) < Date.now()) throw new Error(message)
  return pending
}

/** Requires the complete token set before verifying the transferred identity. */
function requireTransferCredentials(
  record: Registration,
): asserts record is TransferCredentials {
  const hasCredentials =
    record.clientId &&
    record.idToken &&
    record.accessToken &&
    record.refreshToken
  if (!hasCredentials) throw new Error('Incomplete transferred registration')
}
