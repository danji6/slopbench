import type { ActionCtx } from '@sb/convex/_generated/server'
import * as Catalog from '@sb/convex/model/provider/catalog'
import {
  discover,
  refreshDetails,
} from '@sb/convex/model/provider/connectionActions'
import { create, list, resolve } from '@sb/convex/model/providers'
import { expect, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'
import { providerFixture } from '~/tests/helpers/provider-db'

test('publishes the catalog before optional details and ignores stale scheduled enrichment', async () => {
  const { ctx } = providerFixture()
  const providerId = await create(ctx, {
    key: 'ollama',
    enabled: true,
    models: [{ id: 'selected', label: 'My label' }],
  })
  const scheduled: { name: string; args: Record<string, unknown> }[] = []
  const actionCtx = {
    scheduler: {
      runAfter: async (
        _delay: number,
        reference: FunctionReference<'action'>,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ name: getFunctionName(reference), args })
        return 'scheduled'
      },
    },
    runQuery: async (
      reference: FunctionReference<'query'>,
      args: Record<string, unknown>,
    ) => {
      const name = getFunctionName(reference)
      if (name === 'providers:get') return (await list(ctx))[0]
      if (name === 'providers:_connection')
        return (await resolve(ctx, ctx.userId))[0]
      if (name === 'providers:catalog')
        return Catalog.catalog(ctx, args as never)
      if (name === 'providers:_detailTargets')
        return Catalog.detailTargets(ctx, args as never)
      throw new Error(name)
    },
    runMutation: async (
      reference: FunctionReference<'mutation'>,
      args: Record<string, unknown>,
    ) => {
      const name = getFunctionName(reference)
      if (name === 'providers:_beginDiscovery')
        return Catalog.begin(ctx, args as never)
      if (name === 'providers:_stageDiscovery')
        return Catalog.stage(ctx, args as never)
      if (name === 'providers:_finishDiscovery')
        return Catalog.finish(ctx, args as never)
      if (name === 'providers:_enrichModel')
        return Catalog.enrich(ctx, args as never)
      if (name === 'providers:_cleanupCatalog') return
      throw new Error(name)
    },
  } as unknown as ActionCtx
  const original = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/tags'))
      return Response.json({
        models: [
          { name: 'selected', digest: 'digest' },
          { name: 'unselected', digest: 'other' },
        ],
      })
    return Response.json({
      model_info: {
        'general.architecture': 'llama',
        'llama.context_length': 128000,
      },
    })
  }) as typeof fetch
  try {
    await discover(actionCtx, { providerId, force: true })
    expect((await Catalog.catalog(ctx, { providerId })).models).toHaveLength(2)
    expect(requests).toHaveLength(1)
    const job = scheduled.find((job) => job.name.endsWith(':_refreshDetails'))!
    expect(job.args.modelIds).toEqual(['selected'])
    await refreshDetails(actionCtx, job.args as never)
    expect(requests).toHaveLength(2)
    expect((await resolve(ctx, ctx.userId))[0].models[0]).toMatchObject({
      label: 'My label',
      contextWindow: 128000,
    })
    await ctx.db.patch(providerId, { configRevision: 1 })
    await refreshDetails(actionCtx, job.args as never)
    expect(requests).toHaveLength(2)
  } finally {
    globalThis.fetch = original
  }
})
