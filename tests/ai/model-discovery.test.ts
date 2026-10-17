import { discoverModels } from '@sb/convex/model/provider/discovery'
import {
  findCredentialsForModel,
  findModelSelection,
} from '@sb/convex/model/provider/providers'
import { modelReference, parseModelReference } from '@sb/core/model-reference'
import { describe, expect, test } from 'bun:test'

function responses(pages: unknown[]) {
  const requests: { url: URL; init?: RequestInit }[] = []
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), init })
    return Response.json(pages.shift())
  }) as typeof fetch
  return { requests, request }
}

describe('provider model discovery', () => {
  test('normalizes API catalogs without inventing capabilities', async () => {
    const fixture = responses([{ data: [{ id: 'unknown-model' }] }])
    expect(
      await discoverModels(
        { id: 'openai', apiKey: 'fixture-key' },
        fixture.request,
      ),
    ).toEqual([
      { id: 'unknown-model', label: undefined, contextWindow: undefined },
    ])
    expect(fixture.requests[0].url.href).toBe(
      'https://api.openai.com/v1/models',
    )
    expect(
      new Headers(fixture.requests[0].init?.headers).get('Authorization'),
    ).toBe('Bearer fixture-key')
    expect(fixture.requests[0].init?.redirect).toBe('error')
  })
  test('uses the subscription schema and preserves account catalog ordering', async () => {
    const fixture = responses([
      {
        models: [
          { slug: 'b', display_name: 'Second', visibility: 'list' },
          { slug: 'hidden', visibility: 'hide' },
          { slug: 'a', display_name: 'First', visibility: 'list' },
        ],
      },
    ])
    expect(
      (
        await discoverModels({ id: 'openai', auth: 'chatgpt' }, fixture.request)
      ).map((model) => model.id),
    ).toEqual(['b', 'a'])
  })
  test('enumerates installed Ollama models at the configured API base', async () => {
    const fixture = responses([{ models: [{ name: 'local:latest' }] }])
    expect(
      (
        await discoverModels(
          { id: 'ollama', baseURL: 'http://localhost:1234/api/' },
          fixture.request,
        )
      )[0].id,
    ).toBe('local:latest')
    expect(fixture.requests[0].url.pathname).toBe('/api/tags')
  })
  test('paginates Anthropic and ignores retired models', async () => {
    const fixture = responses([
      {
        data: [
          { id: 'new', display_name: 'New', max_input_tokens: 200000 },
          { id: 'old', lifecycle: 'retired' },
        ],
        has_more: true,
        last_id: 'old',
      },
      { data: [{ id: 'another' }], has_more: false },
    ])
    const models = await discoverModels(
      { id: 'anthropic', apiKey: 'fixture-key' },
      fixture.request,
    )
    expect(models.map((model) => model.id)).toEqual(['new', 'another'])
    expect(models[0].contextWindow).toBe(200000)
    expect(fixture.requests[1].url.searchParams.get('after_id')).toBe('old')
    expect(
      new Headers(fixture.requests[0].init?.headers).get('x-api-key'),
    ).toBe('fixture-key')
  })
  test('rejects incomplete and malformed catalogs instead of accepting partial data', async () => {
    const fixture = responses([
      { data: [{ id: 'a' }], has_more: true, last_id: 'a' },
      { data: [{ id: 'b' }], has_more: true, last_id: 'a' },
    ])
    await expect(
      discoverModels({ id: 'anthropic' }, fixture.request),
    ).rejects.toThrow('pagination')
    await expect(
      discoverModels({ id: 'openai' }, responses([{}]).request),
    ).rejects.toThrow()
    await expect(
      discoverModels({ id: 'openai' }, responses([{ data: [{}] }]).request),
    ).rejects.toThrow()
  })
  test('filters known incompatible OpenRouter models and retains unknown metadata', async () => {
    const fixture = responses([
      {
        data: [
          {
            id: 'text',
            name: 'Text',
            context_length: 128000,
            architecture: { output_modalities: ['text'] },
          },
          { id: 'image', architecture: { output_modalities: ['image'] } },
          { id: 'unknown' },
        ],
      },
    ])
    expect(
      (await discoverModels({ id: 'openrouter' }, fixture.request)).map(
        (model) => model.id,
      ),
    ).toEqual(['text', 'unknown'])
  })
})

describe('model connection identity', () => {
  const providers = ['personal', 'work'].map((connectionId) => ({
    connectionId,
    id: 'openai',
    enabled: true,
    apiKey: `${connectionId}-key`,
    models: [{ id: 'same/model:latest', label: connectionId }],
  }))
  test('round-trips IDs and keeps accounts separate', () => {
    const ref = modelReference('work', 'same/model:latest')
    expect(parseModelReference(ref)).toEqual({
      connectionId: 'work',
      modelId: 'same/model:latest',
    })
    expect(findCredentialsForModel(providers, ref)?.apiKey).toBe('work-key')
    expect(findModelSelection(providers, ref)?.id).toBe(ref)
    expect(findCredentialsForModel(providers, 'same/model:latest')).toBeNull()
  })
  test('does not fall back after a connection is disabled or removed', () => {
    const ref = modelReference('work', 'same/model:latest')
    expect(findCredentialsForModel([providers[0]], ref)).toBeNull()
    expect(
      findCredentialsForModel(
        [providers[0], { ...providers[1], enabled: false }],
        ref,
      ),
    ).toBeNull()
    expect(
      findCredentialsForModel(
        providers,
        modelReference('foreign', 'same/model:latest'),
      ),
    ).toBeNull()
  })
})

test('paginates OpenRouter and rejects cross-origin and cycling continuations', async () => {
  const fixture = responses([
    {
      data: [{ id: 'one' }],
      links: { next: '/api/v1/models?offset=500&limit=500' },
    },
    { data: [{ id: 'two' }], links: { next: null } },
  ])
  expect(
    (await discoverModels({ id: 'openrouter' }, fixture.request)).map(
      (model) => model.id,
    ),
  ).toEqual(['one', 'two'])
  expect(fixture.requests[0].url.searchParams.get('limit')).toBe('500')
  expect(fixture.requests[1].url.searchParams.get('offset')).toBe('500')
  await expect(
    discoverModels(
      { id: 'openrouter' },
      responses([{ data: [], links: { next: 'https://foreign.test/models' } }])
        .request,
    ),
  ).rejects.toThrow('Unsafe')
  await expect(
    discoverModels(
      { id: 'openrouter' },
      responses([
        { data: [], links: { next: '/api/v1/models?offset=0&limit=500' } },
      ]).request,
    ),
  ).rejects.toThrow('pagination')
})

test('extracts advertised provider metadata without inventing reasoning tiers', async () => {
  const router = await discoverModels(
    { id: 'openrouter' },
    responses([
      {
        data: [
          {
            id: 'one',
            context_length: 128000,
            supported_parameters: ['reasoning', 'temperature'],
            top_provider: { max_completion_tokens: 16000 },
            default_parameters: { temperature: 0.6, top_p: 0.9 },
          },
        ],
      },
    ]).request,
  )
  expect(router[0]).toMatchObject({
    contextWindow: 128000,
  })
  expect(router[0].reasoning).toBeUndefined()
  expect(router[0]).not.toHaveProperty('inference')
  expect(router[0]).not.toHaveProperty('outputLimit')
  expect(router[0]).not.toHaveProperty('supportedParameters')
  const anthropic = await discoverModels(
    { id: 'anthropic' },
    responses([
      {
        data: [
          {
            id: 'one',
            capabilities: {
              effort: {
                supported: true,
                low: { supported: true },
                high: { supported: false },
                max: { supported: true },
              },
            },
          },
        ],
      },
    ]).request,
  )
  expect(anthropic[0].reasoning).toEqual({
    type: 'effort',
    efforts: ['low', 'max'],
  })
  const { ollamaMetadata } =
    await import('@sb/convex/model/provider/discovery/ollama')
  expect(
    ollamaMetadata({
      model_info: {
        'general.architecture': 'llama',
        'llama.context_length': 128000,
      },
      parameters: 'temperature 0.8\nnum_ctx 4096',
      thinking: { values: [false, 'low', 'high'] },
    }),
  ).toMatchObject({
    contextWindow: 128000,
    reasoning: { type: 'effort', efforts: ['low', 'high'] },
  })
})
