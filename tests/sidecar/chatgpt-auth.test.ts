import {
  cancelSignIn,
  connectionStatus,
  startSignIn,
} from '@sb/sidecar/providers/openai/oauth'
import {
  readRegistration,
  saveRegistration,
  withRegistrationLock,
} from '@sb/sidecar/providers/openai/storage'
import { accessToken, disconnect } from '@sb/sidecar/providers/openai/tokens'
import {
  importTransfer,
  prepareTransfer,
} from '@sb/sidecar/providers/openai/transfer'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const originalFetch = globalThis.fetch
const originalDirectory = process.env.SLOPBENCH_AUTH_DIR
let directory: string
const signing = await generateKeyPair('RS256')
const publicKey = {
  ...(await exportJWK(signing.publicKey)),
  kid: 'fixture-key',
  alg: 'RS256',
}
let issuedNonce = ''
let subject = 'account-a'
let scope =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
let refreshes = 0
let tokenBody = new URLSearchParams()

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sb-oauth-test-'))
  process.env.SLOPBENCH_AUTH_DIR = directory
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init)
    if (url.endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer: 'https://auth.openai.com',
        jwks_uri: 'https://auth.openai.com/jwks',
        revocation_endpoint: 'https://auth.openai.com/revoke',
      })
    if (url.endsWith('/jwks')) return Response.json({ keys: [publicKey] })
    if (url.endsWith('/revoke')) return new Response('', { status: 200 })
    if (url.endsWith('/oauth/token')) {
      tokenBody = new URLSearchParams(String(init?.body))
      if (tokenBody.get('grant_type') === 'refresh_token') refreshes++
      const id_token = await new SignJWT({
        nonce: issuedNonce,
        email: 'fixture@example.com',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key' })
        .setIssuer('https://auth.openai.com')
        .setAudience('issued-client')
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(signing.privateKey)
      return Response.json({
        access_token: `access-${refreshes}`,
        refresh_token: `refresh-${refreshes}`,
        id_token,
        token_type: 'Bearer',
        expires_in: 3600,
        scope,
      })
    }
    throw new Error('Unexpected external request in OAuth test')
  }) as typeof fetch
})
afterAll(async () => {
  globalThis.fetch = originalFetch
  if (originalDirectory === undefined) delete process.env.SLOPBENCH_AUTH_DIR
  else process.env.SLOPBENCH_AUTH_DIR = originalDirectory
  await rm(directory, { recursive: true, force: true })
})

async function authorize(connectionId: string) {
  const key = { ownerId: 'fixture-owner', connectionId }
  const started = await startSignIn(key)
  const url = new URL(started.url)
  issuedNonce = url.searchParams.get('nonce')!
  const callback = new URL(url.searchParams.get('redirect_uri')!)
  callback.search = new URLSearchParams({
    state: url.searchParams.get('state')!,
    code: 'fixture-code',
    client_id: 'issued-client',
  }).toString()
  return { key, url, callback }
}

describe('ChatGPT OAuth lifecycle', () => {
  test('cancels an attempt before asynchronous listener setup finishes', async () => {
    const key = { ownerId: 'fixture-owner', connectionId: 'cancel-early' }
    const pending = startSignIn(key)
    cancelSignIn(key)
    await expect(pending).rejects.toThrow()
    expect(await readRegistration(key)).toBeUndefined()
  })
  test('validates state, exchanges exact PKCE redirect and stores protected credentials', async () => {
    const { key, url, callback } = await authorize('a')
    expect(url.searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(url.searchParams.get('agent_name_hint')).toBe('slopbench')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('ext_agent_host_id')).toStartWith('urn:uuid:')
    const wrong = new URL(callback)
    wrong.searchParams.set('state', 'wrong')
    expect((await fetch(wrong)).status).toBe(400)
    expect(await readRegistration(key)).toBeUndefined()
    expect((await fetch(callback)).status).toBe(200)
    expect(tokenBody.get('client_id')).toBe('issued-client')
    expect(tokenBody.get('redirect_uri')).toBe(
      callback.origin + '/auth/callback',
    )
    expect(tokenBody.get('code_verifier')).toBeTruthy()
    const record = await readRegistration(key)
    expect(record?.subject).toBe('account-a')
    expect(record?.accessToken).toBe('access-0')
    for (const file of await readdir(directory)) {
      if (file.endsWith('.json') && process.platform !== 'win32')
        expect((await stat(join(directory, file))).mode & 0o777).toBe(0o600)
    }
    cancelSignIn(key)
  })
  test('reuses registrations and rejects switching identity during reconnect', async () => {
    const { key, url, callback } = await authorize('a')
    expect(url.searchParams.get('client_id')).toBe('issued-client')
    expect(url.searchParams.has('agent_name_hint')).toBe(false)
    const before = await readRegistration(key)
    subject = 'another-account'
    expect((await fetch(callback)).status).toBe(400)
    expect((await readRegistration(key))?.accessToken).toBe(before?.accessToken)
    expect((await readRegistration(key))?.subject).toBe('account-a')
    subject = 'account-a'
    cancelSignIn(key)
  })
  test('serializes concurrent refreshes and saves the replacement token', async () => {
    const key = { ownerId: 'fixture-owner', connectionId: 'a' }
    const record = (await readRegistration(key))!
    await withRegistrationLock(key, () =>
      saveRegistration(key, { ...record, expiresAt: 0 }),
    )
    const tokens = await Promise.all([
      accessToken(key),
      accessToken(key),
      accessToken(key),
    ])
    expect(refreshes).toBe(1)
    expect(new Set(tokens)).toEqual(new Set(['access-1']))
    expect((await readRegistration(key))?.refreshToken).toBe('refresh-1')
    expect(tokenBody.has('scope')).toBe(false)
  })
  test('retains identity while disabling inference when permission was declined', async () => {
    scope = 'openid profile email'
    const { key, callback } = await authorize('no-plan')
    expect((await fetch(callback)).status).toBe(200)
    expect((await connectionStatus(key)).planEnabled).toBe(false)
    await expect(accessToken(key)).rejects.toThrow('plan permission')
    scope =
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
    cancelSignIn(key)
  })
  test('remote import is bound to a host, connection and expiring one-time ticket', async () => {
    const key = { ownerId: 'fixture-owner', connectionId: 'remote' }
    const setup = await prepareTransfer(key)
    const record = (await readRegistration({
      ownerId: 'fixture-owner',
      connectionId: 'a',
    }))!
    await expect(
      importTransfer({
        setup,
        registration: { ...record, hostId: 'another-host' },
      }),
    ).rejects.toThrow('host identifier')
    const registration = { ...record, hostId: setup.hostId }
    await expect(
      importTransfer({ setup: { ...setup, nonce: 'replaced' }, registration }),
    ).rejects.toThrow('ticket')
    await expect(
      importTransfer({
        setup,
        registration: { ...registration, refreshToken: undefined },
      }),
    ).rejects.toThrow('Incomplete transferred registration')
    await expect(
      importTransfer({
        setup,
        registration: { ...registration, subject: 'another-account' },
      }),
    ).rejects.toThrow('identity does not match')
    expect((await readRegistration(key))?.transferNonce).toBe(setup.nonce)
    await importTransfer({ setup, registration })
    expect((await connectionStatus(key)).status).toBe('connected')
    await expect(
      importTransfer({ setup, registration: record }),
    ).rejects.toThrow('ticket')
  })
  test('expired transfer tickets leave the pending registration untouched', async () => {
    const key = { ownerId: 'fixture-owner', connectionId: 'expired' }
    const setup = await prepareTransfer(key)
    const pending = (await readRegistration(key))!
    const expired = { ...pending, transferExpiresAt: Date.now() - 1 }
    await withRegistrationLock(key, () => saveRegistration(key, expired))
    await expect(
      importTransfer({ setup, registration: setup.registration }),
    ).rejects.toThrow('ticket')
    expect(await readRegistration(key)).toEqual(expired)
  })
  test('disconnect clears renewable credentials but retains the registration', async () => {
    const key = { ownerId: 'fixture-owner', connectionId: 'a' }
    expect(await disconnect(key)).toEqual({ revoked: true })
    expect(await readRegistration(key)).toMatchObject({
      clientId: 'issued-client',
      subject: 'account-a',
      scopes: [],
    })
    expect((await readRegistration(key))?.refreshToken).toBeUndefined()
    await expect(accessToken(key)).rejects.toThrow('Continue with ChatGPT')
  })
})
