import { deletePreview, storePreview } from '@sb/convex/model/provider/previews'
import { ensureConnection, saveProviders } from '@sb/convex/model/provider/save'
import {
  create,
  list,
  resolve,
  setModelInference,
  update,
} from '@sb/convex/model/providers'
import { discoveryFingerprint } from '@sb/core/discovery-fingerprint'
import { modelReference } from '@sb/core/model-reference'
import { expect, test } from 'bun:test'

import { providerFixture } from '../helpers/provider-db'

test('global batch save preserves identities and credentials and accepts duplicate default names', async () => {
  const { ctx } = providerFixture()
  const id = await create(ctx, {
    key: 'openai',
    enabled: true,
    apiKey: 'fixture-key',
    models: [],
  })
  const result = await saveProviders(ctx, {
    connections: [
      {
        key: 'openai',
        enabled: true,
        models: [{ id: 'model' }],
        providerId: id,
        clientId: 'existing',
        configRevision: 0,
      },
      { key: 'openai', enabled: false, models: [], clientId: 'new' },
    ],
    removed: [],
  })
  expect(result[0].providerId).toBe(id)
  expect((await resolve(ctx, ctx.userId))[0].apiKey).toBe('fixture-key')
  expect((await list(ctx)).map((row) => row.name)).toEqual(['OpenAI', 'OpenAI'])
  expect(result[0].configRevision).toBe(1)
  await expect(
    saveProviders(ctx, {
      connections: [
        {
          key: 'openai',
          enabled: true,
          models: [],
          providerId: id,
          clientId: 'existing',
          configRevision: 0,
        },
      ],
      removed: [],
    }),
  ).rejects.toThrow('Connection changed')
})

test('sign-in creates an idempotent identity independently of configuration and authentication does not change its settings revision', async () => {
  const { ctx } = providerFixture()
  const input = { key: 'openai', auth: 'chatgpt' as const, clientId: 'draft' }
  const first = await ensureConnection(ctx, input)
  expect(await ensureConnection(ctx, input)).toBe(first)
  expect((await list(ctx))[0]).toMatchObject({
    name: 'OpenAI',
    models: [],
    enabled: false,
    configRevision: 0,
  })
  await expect(
    ensureConnection(ctx, { ...input, key: 'anthropic' }),
  ).rejects.toThrow()
  const saved = await saveProviders(ctx, {
    connections: [{ ...input, configRevision: 0, models: [], enabled: true }],
    removed: [],
  })
  expect(saved[0].providerId).toBe(first)
  expect(await list(ctx)).toHaveLength(1)
})

test('preview adoption requires the same owner and exact network configuration, and expiry cannot remove a published catalog', async () => {
  const { ctx, find } = providerFixture()
  const connection = {
    id: 'openrouter',
    auth: 'apiKey' as const,
    apiKey: 'fixture-key',
    baseURL: 'https://router.test/v1',
  }
  const previewId = await storePreview(ctx, {
    ownerId: ctx.userId,
    fingerprint: await discoveryFingerprint(connection),
    models: [
      {
        id: 'one',
        label: 'One',
        contextWindow: 128000,
        reasoning: { type: 'effort', efforts: ['low', 'high'] },
      },
    ],
  })
  const input = {
    key: connection.id,
    auth: connection.auth,
    apiKey: connection.apiKey,
    baseURL: connection.baseURL,
    enabled: true,
    clientId: 'draft',
    previewId,
    models: [{ id: 'one', source: 'discovered' as const, label: 'Custom' }],
  }
  await expect(
    saveProviders(ctx, {
      connections: [{ ...input, apiKey: 'different' }],
      removed: [],
    }),
  ).rejects.toThrow('Connection changed')
  const foreign = { ...ctx, userId: 'other' as typeof ctx.userId }
  await expect(
    saveProviders(foreign, { connections: [input], removed: [] }),
  ).rejects.toThrow('preview expired')
  const saved = await saveProviders(ctx, { connections: [input], removed: [] })
  const id = saved[0].providerId
  expect(find(id)?.discoveryGeneration).toBe(previewId)
  expect((await resolve(ctx, ctx.userId))[0].models[0]).toMatchObject({
    label: 'Custom',
    contextWindow: 128000,
    reasoning: { type: 'effort', efforts: ['low', 'high'] },
    available: true,
  })
  await deletePreview(ctx, { previewId })
  expect(find(id)?.discoveryGeneration).toBe(previewId)
  expect(find(previewId)).toBeUndefined()
})

test('explicit deletions check revision and duplicate save identities are rejected', async () => {
  const { ctx } = providerFixture()
  const id = await create(ctx, { key: 'openai', enabled: true, models: [] })
  await update(ctx, { providerId: id, name: 'Edited' })
  await expect(
    saveProviders(ctx, {
      connections: [],
      removed: [{ providerId: id, configRevision: 0 }],
    }),
  ).rejects.toThrow('Connection changed')
  expect(await list(ctx)).toHaveLength(1)
  const connection = {
    key: 'openai',
    clientId: 'duplicate',
    providerId: id,
    configRevision: 1,
    enabled: true,
    models: [],
  }
  await expect(
    saveProviders(ctx, { connections: [connection, connection], removed: [] }),
  ).rejects.toThrow('Duplicate connection')
  await saveProviders(ctx, {
    connections: [],
    removed: [{ providerId: id, configRevision: 1 }],
  })
  expect(await list(ctx)).toHaveLength(0)
})

test('subscription models retain custom inference and advanced settings', async () => {
  const { ctx } = providerFixture()
  const id = await create(ctx, {
    key: 'openai',
    auth: 'chatgpt',
    enabled: true,
    models: [],
  })
  // Discovery availability is server-owned; use the actual preview publication path.
  const model = {
    id: 'one',
    source: 'discovered' as const,
    inference: { temperature: 0.7 },
    extraParameters: '{"max_output_tokens":400}',
  }
  const { begin, stage, finish } =
    await import('@sb/convex/model/provider/catalog')
  const run = {
    providerId: id,
    ownerId: ctx.userId,
    revision: 0,
    generation: 'catalog',
  }
  await begin(ctx, { ...run, force: true })
  await stage(ctx, { ...run, offset: 0, models: [{ id: 'one' }] })
  await finish(ctx, run)
  await update(ctx, { providerId: id, models: [model] })
  await setModelInference(ctx, {
    modelId: modelReference(id, 'one'),
    inference: { temperature: 0.2 },
  })
  expect((await resolve(ctx, ctx.userId))[0].models[0]).toMatchObject({
    inference: { temperature: 0.2 },
    extraParameters: '{"max_output_tokens":400}',
  })
})

test('refreshing a changed endpoint preserves previously configured missing models as unavailable', async () => {
  const { ctx } = providerFixture()
  const id = await create(ctx, { key: 'openai', enabled: true, models: [] })
  const { begin, stage, finish } =
    await import('@sb/convex/model/provider/catalog')
  const run = {
    providerId: id,
    ownerId: ctx.userId,
    revision: 0,
    generation: 'old',
  }
  await begin(ctx, { ...run, force: true })
  await stage(ctx, { ...run, offset: 0, models: [{ id: 'previous' }] })
  await finish(ctx, run)
  await update(ctx, {
    providerId: id,
    configRevision: 0,
    models: [{ id: 'previous', source: 'discovered' }],
  })
  const connection = { id: 'openai', baseURL: 'https://changed.test/v1' }
  const previewId = await storePreview(ctx, {
    ownerId: ctx.userId,
    fingerprint: await discoveryFingerprint(connection),
    models: [{ id: 'different' }],
  })
  await saveProviders(ctx, {
    removed: [],
    connections: [
      {
        providerId: id,
        clientId: 'existing',
        configRevision: 1,
        key: 'openai',
        baseURL: connection.baseURL,
        enabled: true,
        previewId,
        models: [{ id: 'previous', source: 'discovered', label: 'Keep me' }],
      },
    ],
  })
  expect((await resolve(ctx, ctx.userId))[0].models[0]).toMatchObject({
    id: 'previous',
    label: 'Keep me',
    available: false,
  })
})
