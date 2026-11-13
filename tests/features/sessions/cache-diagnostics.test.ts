import type { AuthQueryCtx } from '@cv/convex/functions'
import {
  getLogUrls,
  getStateView,
} from '@cv/convex/model/session/sessionQueries'
import { expect, test } from 'bun:test'

import { lifecycleDatabase } from '../../helpers/lifecycle-db'

test('exposes diagnostics only to members through the request log query', async () => {
  const database = lifecycleDatabase({
    sessions: [{ _id: 'session', ownerId: 'owner' }],
    userSessions: [
      { _id: 'membership', sessionId: 'session', userId: 'member' },
    ],
    sessionState: [
      {
        _id: 'state',
        sessionId: 'session',
        log: 'log',
        cacheDiagnostics: [{ id: 'sanitized-request' }],
      },
    ],
    streams: [
      {
        _id: 'stream',
        sessionId: 'session',
        providerContinuity: { value: { token: 'private-routing-state' } },
      },
    ],
  })
  let storageReads = 0
  const ctx = {
    ...(database.ctx as AuthQueryCtx),
    userId: 'member',
    storage: {
      getUrl: async () => {
        storageReads++
        return 'https://fixture.invalid/log'
      },
    },
  } as unknown as AuthQueryCtx
  const args = { sessionId: 'session' as never }
  const log = await getLogUrls(ctx, args)
  expect(log?.logUrl).toBe('https://fixture.invalid/log')
  expect(log?.cacheDiagnostics.map((entry) => entry.id)).toEqual([
    'sanitized-request',
  ])
  const view = await getStateView(ctx, args)
  expect(view).not.toHaveProperty('cacheDiagnostics')
  expect(JSON.stringify(view)).not.toContain('private-routing-state')
  expect(
    await getLogUrls({ ...ctx, userId: 'outsider' as never }, args),
  ).toBeNull()
  expect(storageReads).toBe(1)
})
