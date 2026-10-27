import {
  begin,
  catalog,
  finish,
  stage,
} from '@sb/convex/model/provider/catalog'
import { create, list, resolve, update } from '@sb/convex/model/providers'
import { expect, test } from 'bun:test'
import { providerFixture } from '~/tests/helpers/provider-db'

test('same-provider connections keep distinct credentials and reject stale saves', async () => {
  const { ctx } = providerFixture()
  await create(ctx, {
    key: 'openai',
    apiKey: 'fixture-personal',
    enabled: true,
    models: [{ id: 'same' }],
  })
  const second = await create(ctx, {
    key: 'openai',
    apiKey: 'fixture-work',
    enabled: true,
    models: [{ id: 'same' }],
  })
  const connections = await resolve(ctx, ctx.userId)
  expect(connections.map((connection) => connection.apiKey)).toEqual([
    'fixture-personal',
    'fixture-work',
  ])
  expect(
    (await list(ctx)).every(
      (connection) => connection.hasKey && !('apiKey' in connection),
    ),
  ).toBe(true)
  await update(ctx, { providerId: second, configRevision: 0, name: 'Work' })
  await expect(
    update(ctx, { providerId: second, configRevision: 0, name: 'Stale' }),
  ).rejects.toThrow('Connection changed')
})

test('publishes only complete catalogs, preserves overrides and does not enable new models', async () => {
  const { ctx, find } = providerFixture()
  const id = await create(ctx, {
    key: 'openai',
    enabled: true,
    models: [{ id: 'configured', label: 'My label', contextWindow: 123 }],
  })
  const run = {
    providerId: id,
    ownerId: ctx.userId,
    revision: 0,
    generation: 'first',
  }
  expect(await begin(ctx, { ...run, force: true })).toBe(true)
  expect(
    await begin(ctx, { ...run, generation: 'duplicate', force: true }),
  ).toBe(false)
  await stage(ctx, {
    ...run,
    offset: 0,
    models: [
      { id: 'configured', label: 'Provider label', contextWindow: 500 },
      { id: 'new' },
    ],
  })
  expect((await catalog(ctx, { providerId: id })).models).toEqual([])
  await finish(ctx, run)
  expect((await catalog(ctx, { providerId: id })).models).toHaveLength(2)
  expect(find(id)?.models).toHaveLength(1)
  await update(ctx, {
    providerId: id,
    configRevision: 0,
    models: [
      {
        id: 'configured',
        source: 'discovered',
        label: 'My label',
        contextWindow: 123,
      },
    ],
  })
  expect((await resolve(ctx, ctx.userId))[0].models[0]).toMatchObject({
    label: 'My label',
    contextWindow: 123,
    discovered: { label: 'Provider label' },
  })
  const next = { ...run, revision: 1, generation: 'next' }
  await ctx.db.patch(id, {
    discovery: {
      ...(await ctx.db.get(id))?.discovery,
      attemptedAt: Date.now() - 20_000,
      retryAt: undefined,
    },
  })
  await begin(ctx, { ...next, force: true })
  await finish(ctx, { ...next, failure: 'Unavailable' })
  expect((await catalog(ctx, { providerId: id })).models).toHaveLength(2)
  expect((find(id)?.models as { available?: boolean }[])[0].available).toBe(
    true,
  )
  await ctx.db.patch(id, {
    discovery: {
      ...(await ctx.db.get(id))?.discovery,
      attemptedAt: Date.now() - 20_000,
      retryAt: undefined,
    },
  })
  await begin(ctx, { ...next, force: true })
  await stage(ctx, { ...next, offset: 0, models: [{ id: 'new' }] })
  await finish(ctx, next)
  expect((find(id)?.models as { available?: boolean }[])[0].available).toBe(
    false,
  )
})

test('discards stale refreshes after configuration changes and never trusts client availability', async () => {
  const { ctx } = providerFixture()
  const id = await create(ctx, { key: 'openai', enabled: true, models: [] })
  const run = {
    providerId: id,
    ownerId: ctx.userId,
    revision: 0,
    generation: 'obsolete',
  }
  await begin(ctx, { ...run, force: true })
  await update(ctx, {
    providerId: id,
    configRevision: 0,
    baseURL: 'https://provider.example/v1',
  })
  await stage(ctx, { ...run, offset: 0, models: [{ id: 'stale' }] })
  await finish(ctx, run)
  expect((await catalog(ctx, { providerId: id })).models).toEqual([])
  await expect(
    update(ctx, {
      providerId: id,
      models: [{ id: 'forged', source: 'discovered', available: true }],
    }),
  ).rejects.toThrow('Refresh discovery')
  const subscription = await create(ctx, {
    key: 'openai',
    auth: 'chatgpt',
    enabled: true,
    models: [],
  })
  await expect(
    update(ctx, { providerId: subscription, models: [{ id: 'manual' }] }),
  ).rejects.toThrow('subscription models')
})

test('clearing optional endpoint fields restores provider defaults and invalidates discovered models', async () => {
  const { ctx, find } = providerFixture()
  const id = await create(ctx, {
    key: 'openai',
    baseURL: 'https://provider.example/v1',
    extraHeaders: '{"X-Test":"fixture"}',
    enabled: true,
    models: [],
  })
  await update(ctx, {
    providerId: id,
    configRevision: 0,
    baseURL: '',
    extraHeaders: '',
  })
  expect(find(id)?.baseURL).toBeUndefined()
  expect(find(id)?.extraHeaders).toBeUndefined()
  expect((await ctx.db.get(id))?.discovery?.generation).toBeUndefined()
})

test('discovery respects daily freshness, backoff, Retry-After, and account reset', async () => {
  const { ctx } = providerFixture()
  const id = await create(ctx, { key: 'openai', enabled: true, models: [] })
  const run = {
    providerId: id,
    ownerId: ctx.userId,
    revision: 0,
    generation: 'one',
  }
  await ctx.db.patch(id, {
    discovery: { refreshedAt: Date.now() - 2 * 60 * 60_000 },
  })
  expect(await begin(ctx, { ...run, force: false })).toBe(false)
  expect(await begin(ctx, { ...run, force: true })).toBe(true)
  await finish(ctx, {
    ...run,
    failure: 'rate limited',
    retryAfter: Date.now() + 3600000,
  })
  await ctx.db.patch(id, {
    discovery: {
      ...(await ctx.db.get(id))?.discovery,
      attemptedAt: Date.now() - 20000,
    },
  })
  expect(await begin(ctx, { ...run, force: true })).toBe(false)
  const { reset } = await import('@sb/convex/model/provider/catalog')
  await reset(ctx, { providerId: id })
  expect(await begin(ctx, { ...run, force: false })).toBe(true)
})

test('nested refresh state survives failures and settings saves without changing inference', async () => {
  const { ctx } = providerFixture()
  const id = await create(ctx, {
    key: 'openai',
    enabled: true,
    models: [{ id: 'test', inference: { temperature: 0.4 } }],
  })
  const run = {
    providerId: id,
    ownerId: ctx.userId,
    revision: 0,
    generation: 'published',
  }
  await begin(ctx, { ...run, force: true })
  await stage(ctx, {
    ...run,
    offset: 0,
    models: [{ id: 'test', label: 'Provider name', contextWindow: 128000 }],
  })
  await finish(ctx, run)
  const published = await ctx.db.get(id)
  await ctx.db.patch(id, {
    discovery: { ...published!.discovery, attemptedAt: Date.now() - 20_000 },
  })
  const failed = { ...run, generation: 'failed' }
  await begin(ctx, { ...failed, force: true })
  await finish(ctx, { ...failed, failure: 'Unauthorized', blocked: true })
  await update(ctx, { providerId: id, configRevision: 0, name: 'Renamed' })

  const saved = await ctx.db.get(id)
  expect(saved!.discovery).toMatchObject({
    generation: 'published',
    error: 'Unauthorized',
    failures: 1,
    blocked: true,
  })
  expect(saved!.discovery!.attempt).toBeUndefined()
  expect(saved!.discovery!.startedAt).toBeUndefined()
  expect(saved!.discovery!.refreshedAt).toBe(published!.discovery!.refreshedAt)
  expect(saved!.discovery!.retryAt).toBeGreaterThan(Date.now())
  const [resolved] = (await resolve(ctx, ctx.userId))[0].models
  expect(resolved).toMatchObject({
    label: 'Provider name',
    contextWindow: 128000,
    inference: { temperature: 0.4 },
    discovered: { label: 'Provider name', contextWindow: 128000 },
  })
})
