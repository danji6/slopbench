import {
  catalog,
  enrich,
  previewModels,
  storePreview,
} from '@sb/convex/model/provider/previews'
import { discoveryFingerprint } from '@sb/core/discovery-fingerprint'
import { expect, test } from 'bun:test'
import { providerFixture } from '~/tests/helpers/provider-db'

test('preview access rejects foreign, changed, and expired work without changing metadata', async () => {
  const { ctx } = providerFixture()
  const connection = { id: 'ollama' }
  const fingerprint = await discoveryFingerprint(connection)
  const model = { id: 'model', detailKey: 'version-1', label: 'Original' }
  const previewId = await storePreview(ctx, {
    ownerId: ctx.userId,
    fingerprint,
    models: [model],
  })
  const update = {
    previewId,
    ownerId: ctx.userId,
    fingerprint,
    model: { ...model, label: 'Changed' },
  }
  const foreign = { ...ctx, userId: 'other' as typeof ctx.userId }
  expect(await catalog(foreign, { previewId })).toBeNull()
  await expect(
    enrich(ctx, { ...update, ownerId: foreign.userId }),
  ).rejects.toThrow('preview expired')
  await expect(
    enrich(ctx, { ...update, fingerprint: 'changed' }),
  ).rejects.toThrow('connection changed')
  expect((await catalog(ctx, { previewId }))?.models).toEqual([model])

  await ctx.db.patch(previewId, { expiresAt: Date.now() - 1 })
  expect(await catalog(ctx, { previewId })).toBeNull()
  await expect(previewModels(ctx, previewId, connection)).rejects.toThrow(
    'preview expired',
  )
  await expect(enrich(ctx, update)).rejects.toThrow('preview expired')

  await ctx.db.delete(previewId)
  await expect(enrich(ctx, update)).rejects.toThrow('preview expired')
})
