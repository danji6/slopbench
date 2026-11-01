import type { ActionCtx } from '@sb/convex/_generated/server'
import {
  prepareProviderRequest,
  recordCacheDiagnostic,
  saveProviderContinuity,
} from '@sb/convex/model/stream/providerRequests'
import { getFunctionName } from 'convex/server'

import { lifecycleDatabase } from './lifecycle-db'

export function streamDiagnosticsFixture() {
  const database = lifecycleDatabase({
    streams: [
      {
        _id: 'stream',
        sessionId: 'session',
        generation: 1,
        attempt: 0,
        state: { phase: 'streaming', processingMessageId: 'message' },
      },
    ],
  })
  const ctx = {
    runMutation: async (reference: never, args: never) => {
      const name = getFunctionName(reference)
      if (name === 'streams:_prepareProviderRequest')
        return prepareProviderRequest(database.ctx, args)
      if (name === 'streams:_saveProviderContinuity')
        return saveProviderContinuity(database.ctx, args)
      if (name === 'streams:_recordCacheDiagnostic')
        return recordCacheDiagnostic(database.ctx, args)
      throw new Error('Unexpected mutation in provider fixture')
    },
  } as unknown as ActionCtx
  return { ...database, databaseCtx: database.ctx, ctx }
}
