import { fetchModelDetails } from '@sb/convex/model/provider/modelDetails'
import { effectiveModel } from '@sb/core/discovered-model'
import { expect, test } from 'bun:test'

test('optional Ollama details are deduplicated, bounded to two requests, and skipped for cached digests', async () => {
  const original = globalThis.fetch
  let active = 0
  let maximum = 0
  let requests = 0
  globalThis.fetch = (async (_input: RequestInfo | URL) => {
    active++
    requests++
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    return Response.json({
      model_info: {
        'general.architecture': 'llama',
        'llama.context_length': 128000,
      },
      thinking: { values: [false, true] },
    })
  }) as typeof fetch
  try {
    const connection = { id: 'ollama', baseURL: 'http://fixture.test/api' }
    const one = { id: 'one', detailKey: 'digest-one' }
    const models = await Promise.all([
      fetchModelDetails(connection, one),
      fetchModelDetails(connection, one),
      ...Array.from({ length: 5 }, (_, index) =>
        fetchModelDetails(connection, {
          id: String(index),
          detailKey: `digest-${index}`,
        }),
      ),
    ])
    expect(requests).toBe(6)
    expect(maximum).toBe(2)
    expect(models[0]).toEqual(models[1])
    expect(models[0]).toMatchObject({
      contextWindow: 128000,
      detailsLoaded: true,
      reasoning: { type: 'binary', parameter: 'think' },
    })
    await fetchModelDetails(connection, models[0])
    expect(requests).toBe(6)
  } finally {
    globalThis.fetch = original
  }
})

test('user overrides take precedence over optional discovered values', () => {
  const model = {
    id: 'one',
    label: 'Mine',
    contextWindow: 4000,
    reasoning: { type: 'none' as const },
    inference: { temperature: 0.4 },
    discoveredLabel: 'Provider',
    discoveredContextWindow: 128000,
    discoveredReasoning: { type: 'effort' as const, efforts: ['low' as const] },
    discoveredInference: { temperature: 0.8, topP: 0.9 },
  }
  expect(effectiveModel(model)).toMatchObject({
    label: 'Mine',
    contextWindow: 4000,
    reasoning: { type: 'none' },
    inference: { temperature: 0.4, topP: 0.9 },
  })
  expect(
    effectiveModel({
      ...model,
      label: undefined,
      contextWindow: undefined,
      reasoning: undefined,
      inference: undefined,
    }),
  ).toMatchObject({
    label: 'Provider',
    contextWindow: 128000,
    reasoning: model.discoveredReasoning,
    inference: model.discoveredInference,
  })
})
