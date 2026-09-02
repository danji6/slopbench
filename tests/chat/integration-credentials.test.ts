/// <reference types="bun-types" />
import { list as listMcp, replaceAll as replaceMcp } from '@sb/convex/model/mcp'
import {
  list as listProviders,
  replaceAll as replaceProviders,
  setModelInference,
} from '@sb/convex/model/providers'
import { MAX_MCP_SCHEMA_CHARS } from '@sb/core/limits'
import { describe, expect, test } from 'bun:test'

const OWNER = 'user_1'

type Row = Record<string, unknown> & { _id: string }

/**
 * A multi-table stub. The integration models reach every table through an
 * index, and the index prefix always starts with `ownerId` (or `serverId`), so
 * matching on the captured equality fields is enough.
 */
function makeCtx(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    mcpServers: [],
    mcpTools: [],
    modelProviders: [],
    credentials: [],
    ...seed,
  }
  let nextId = 1

  const find = (id: string) =>
    Object.values(tables)
      .flat()
      .find((row) => row._id === id)

  const ctx = {
    userId: OWNER,
    db: {
      get: async (id: string) => find(id) ?? null,
      insert: async (table: string, doc: Record<string, unknown>) => {
        const _id = `${table}_${nextId++}`
        tables[table].push({ _id, ...doc })
        return _id
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = find(id)
        if (row) Object.assign(row, patch)
      },
      delete: async (id: string) => {
        for (const rows of Object.values(tables)) {
          const index = rows.findIndex((row) => row._id === id)
          if (index !== -1) rows.splice(index, 1)
        }
      },
      query: (table: string) => ({
        withIndex: (_index: string, build?: (q: unknown) => unknown) => {
          const captured: Record<string, unknown> = {}
          const q = {
            eq: (field: string, value: unknown) => {
              captured[field] = value
              return q
            },
          }
          build?.(q)

          const matches = tables[table].filter((row) =>
            Object.entries(captured).every(
              ([key, value]) => row[key] === value,
            ),
          )
          const sorted = [...matches].sort(
            (a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0),
          )

          return {
            order: () => ({ collect: async () => sorted }),
            collect: async () => sorted,
            unique: async () => sorted[0] ?? null,
          }
        },
      }),
    },
  } as never

  return { ctx, tables }
}

describe('MCP servers', () => {
  const SERVER = {
    key: 'srv_1',
    label: 'Docs',
    url: 'https://mcp.example.com',
    transport: 'http' as const,
    enabled: true,
  }

  test('the key lands in credentials and never in the listing', async () => {
    const { ctx, tables } = makeCtx()

    await replaceMcp(ctx, {
      servers: [
        {
          key: 'srv_1',
          label: 'Docs',
          url: 'https://mcp.example.com',
          transport: 'http',
          enabled: true,
          apiKey: 'secret',
        },
      ],
    })

    expect(tables.mcpServers[0]).not.toHaveProperty('apiKey')
    expect(tables.credentials[0]).toMatchObject({
      ownerId: OWNER,
      scope: 'mcp',
      ref: 'srv_1',
      apiKey: 'secret',
    })

    const listed = await listMcp(ctx)
    expect(listed[0].hasKey).toBe(true)
    expect(listed[0]).not.toHaveProperty('apiKey')
  })

  test('an absent key leaves the stored one alone', async () => {
    const { ctx, tables } = makeCtx()

    await replaceMcp(ctx, { servers: [{ ...SERVER, apiKey: 'secret' }] })
    await replaceMcp(ctx, { servers: [{ ...SERVER, label: 'Renamed' }] })

    expect(tables.mcpServers[0].label).toBe('Renamed')
    expect(tables.credentials).toHaveLength(1)
    expect(tables.credentials[0].apiKey).toBe('secret')
  })

  test('an empty key clears the credential', async () => {
    const { ctx, tables } = makeCtx()

    await replaceMcp(ctx, { servers: [{ ...SERVER, apiKey: 'secret' }] })
    await replaceMcp(ctx, { servers: [{ ...SERVER, apiKey: '' }] })

    expect(tables.credentials).toEqual([])
  })

  test('staged tools are written on save and clamped on the way in', async () => {
    const { ctx, tables } = makeCtx()

    await replaceMcp(ctx, {
      servers: [
        {
          ...SERVER,
          tools: [
            { name: 'search', description: 'Search the docs' },
            {
              name: 'fetch',
              inputSchema: 'x'.repeat(MAX_MCP_SCHEMA_CHARS + 1),
            },
          ],
        },
      ],
    })

    expect(tables.mcpTools).toHaveLength(2)
    expect(tables.mcpTools[0]).toMatchObject({ name: 'search', order: 0 })
    expect(tables.mcpTools[1].inputSchema).toHaveLength(MAX_MCP_SCHEMA_CHARS)
  })

  test('an absent tool set leaves the discovered one alone', async () => {
    const { ctx, tables } = makeCtx()

    await replaceMcp(ctx, {
      servers: [{ ...SERVER, tools: [{ name: 'search' }] }],
    })
    await replaceMcp(ctx, { servers: [{ ...SERVER, label: 'Renamed' }] })

    expect(tables.mcpServers[0].label).toBe('Renamed')
    expect(tables.mcpTools).toHaveLength(1)
  })

  test('an unchanged tool set is not rewritten', async () => {
    const { ctx, tables } = makeCtx()
    const tools = [{ name: 'search', description: 'Search the docs' }]

    await replaceMcp(ctx, { servers: [{ ...SERVER, tools }] })
    const before = tables.mcpTools[0]._id

    // The form always submits what it was seeded with, so an unrelated edit
    // must not churn every tool row
    await replaceMcp(ctx, { servers: [{ ...SERVER, label: 'Renamed', tools }] })

    expect(tables.mcpTools[0]._id).toBe(before)
  })

  test('tool metadata overrides ride along with the tool set', async () => {
    const { ctx, tables } = makeCtx()

    await replaceMcp(ctx, {
      servers: [{ ...SERVER, tools: [{ name: 'search' }] }],
    })
    await replaceMcp(ctx, {
      servers: [
        {
          ...SERVER,
          tools: [
            {
              name: 'search',
              nameOverride: 'find',
              descriptionOverride: 'Mine',
            },
          ],
        },
      ],
    })

    expect(tables.mcpTools).toHaveLength(1)
    expect(tables.mcpTools[0].nameOverride).toBe('find')
    expect(tables.mcpTools[0].descriptionOverride).toBe('Mine')
  })

  test('removing a server takes its tools and credential with it', async () => {
    const { ctx, tables } = makeCtx()

    await replaceMcp(ctx, {
      servers: [
        {
          key: 'srv_1',
          label: 'Docs',
          url: 'https://mcp.example.com',
          transport: 'http',
          enabled: true,
          apiKey: 'secret',
        },
      ],
    })
    tables.mcpTools.push({
      _id: 'mcpTools_1',
      serverId: tables.mcpServers[0]._id,
      name: 'search',
      order: 0,
    })

    await replaceMcp(ctx, { servers: [] })

    expect(tables.mcpServers).toEqual([])
    expect(tables.mcpTools).toEqual([])
    expect(tables.credentials).toEqual([])
  })
})

describe('model providers', () => {
  test('round-trips a custom provider endpoint', async () => {
    const { ctx, tables } = makeCtx()

    await replaceProviders(ctx, {
      providers: [
        {
          key: 'custom-service',
          baseURL: 'https://custom.example/v1',
          enabled: true,
          models: [],
        },
      ],
    })

    expect(tables.modelProviders[0].baseURL).toBe('https://custom.example/v1')
    expect((await listProviders(ctx))[0].baseURL).toBe(
      'https://custom.example/v1',
    )
  })

  test('round-trips a manually configured Qwen endpoint', async () => {
    const { ctx, tables } = makeCtx()

    await replaceProviders(ctx, {
      providers: [
        {
          key: 'qwen',
          baseURL: 'https://qwen.example/v1',
          enabled: true,
          models: [],
        },
      ],
    })

    expect(tables.modelProviders[0].baseURL).toBe('https://qwen.example/v1')
    expect((await listProviders(ctx))[0].baseURL).toBe(
      'https://qwen.example/v1',
    )
  })

  test('the key lands in credentials and never in the listing', async () => {
    const { ctx, tables } = makeCtx()

    await replaceProviders(ctx, {
      providers: [
        { key: 'openai', enabled: true, models: [], apiKey: 'sk-test' },
      ],
    })

    expect(tables.modelProviders[0]).not.toHaveProperty('apiKey')
    expect(tables.credentials[0]).toMatchObject({
      scope: 'provider',
      ref: 'openai',
      apiKey: 'sk-test',
    })

    const listed = await listProviders(ctx)
    expect(listed[0].hasKey).toBe(true)
    expect(listed[0]).not.toHaveProperty('apiKey')
  })

  test('removing a provider drops its credential', async () => {
    const { ctx, tables } = makeCtx()

    await replaceProviders(ctx, {
      providers: [
        { key: 'openai', enabled: true, models: [], apiKey: 'sk-test' },
      ],
    })
    await replaceProviders(ctx, { providers: [] })

    expect(tables.modelProviders).toEqual([])
    expect(tables.credentials).toEqual([])
  })

  test('round-trips per-model reasoning, extras, and inference', async () => {
    const { ctx, tables } = makeCtx()
    const model = {
      id: 'custom-model',
      reasoning: {
        type: 'binary' as const,
        parameter: 'thinking_enabled',
      },
      extraParameters: '{"service_tier":"fast"}',
      inference: { temperature: 0.4, topP: 0.8 },
    }

    await replaceProviders(ctx, {
      providers: [
        {
          key: 'custom',
          enabled: true,
          extraHeaders: '{"X-Custom":"value"}',
          models: [model],
        },
      ],
    })

    expect(tables.modelProviders[0].models).toEqual([model])
    const listed = await listProviders(ctx)
    expect(listed[0].models).toEqual([model])
    expect(listed[0].extraHeaders).toBe('{"X-Custom":"value"}')
  })

  test('updates one model inference configuration without rewriting siblings', async () => {
    const { ctx, tables } = makeCtx()
    await replaceProviders(ctx, {
      providers: [
        {
          key: 'openai',
          enabled: true,
          models: [
            { id: 'model-a', label: 'A' },
            { id: 'model-b', inference: { temperature: 0.2 } },
          ],
        },
      ],
    })

    await setModelInference(ctx, {
      modelId: 'model-a',
      inference: { temperature: 0.7, presencePenalty: 0.3 },
    })

    expect(tables.modelProviders[0].models).toEqual([
      {
        id: 'model-a',
        label: 'A',
        inference: { temperature: 0.7, presencePenalty: 0.3 },
      },
      { id: 'model-b', inference: { temperature: 0.2 } },
    ])
  })

  test('clears an empty model inference configuration', async () => {
    const { ctx, tables } = makeCtx()
    await replaceProviders(ctx, {
      providers: [
        {
          key: 'openai',
          enabled: true,
          models: [{ id: 'model-a', inference: { temperature: 0.2 } }],
        },
      ],
    })

    await setModelInference(ctx, { modelId: 'model-a', inference: {} })

    expect(tables.modelProviders[0].models).toEqual([{ id: 'model-a' }])
  })

  test('normalizes the obsolete binary default for Ollama models', async () => {
    const { ctx, tables } = makeCtx({
      modelProviders: [
        {
          _id: 'modelProviders_legacy',
          ownerId: OWNER,
          key: 'ollama',
          enabled: true,
          order: 0,
          models: [
            {
              id: 'legacy-model',
              reasoning: {
                type: 'binary',
                parameter: 'enable_thinking',
              },
            },
          ],
        },
      ],
    })

    const listed = await listProviders(ctx)
    expect(listed[0].models[0].reasoning).toEqual({
      type: 'binary',
      parameter: 'think',
    })

    await replaceProviders(ctx, {
      providers: [
        {
          key: 'ollama',
          enabled: true,
          models: listed[0].models,
        },
      ],
    })
    expect(tables.modelProviders[0].models).toEqual(listed[0].models)
  })

  test('rejects invalid model extra parameters', async () => {
    const { ctx } = makeCtx()

    expect(
      replaceProviders(ctx, {
        providers: [
          {
            key: 'custom',
            enabled: true,
            models: [{ id: 'bad', extraParameters: '{"messages":[]}' }],
          },
        ],
      }),
    ).rejects.toThrow('reserved fields')
  })

  test('rejects transport-managed provider headers', async () => {
    const { ctx } = makeCtx()

    expect(
      replaceProviders(ctx, {
        providers: [
          {
            key: 'custom',
            enabled: true,
            extraHeaders: '{"Host":"example.com"}',
            models: [],
          },
        ],
      }),
    ).rejects.toThrow('managed by the HTTP transport')
  })
})
