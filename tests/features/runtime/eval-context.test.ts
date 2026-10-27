/// <reference types="bun-types" />
import { buildEvalContext } from '@sb/convex/actions/stream/evalContext'
import type { Session } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

function contextForModel(model?: Session['model']) {
  return buildEvalContext({
    agent: { name: 'Fable' } as never,
    invoker: { role: 'user' } as never,
    invokerSettings: null,
    owner: {} as never,
    ownerSettings: null,
    session: { model } as Session,
    userCount: 1,
    agentCount: 1,
    toolNames: [],
  })
}

describe('model evaluation context', () => {
  test('exposes the session model ID and configured label', () => {
    expect(contextForModel({ id: 'model-a', label: 'Model A' })).toMatchObject({
      modelId: 'model-a',
      modelName: 'Model A',
    })
  })

  test('falls back to the ID for an unlabeled or unknown model', () => {
    expect(contextForModel({ id: 'custom-model' })).toMatchObject({
      modelId: 'custom-model',
      modelName: 'custom-model',
    })
  })

  test('leaves both variables undefined without a selected model', () => {
    const context = contextForModel()
    expect(context.modelId).toBeUndefined()
    expect(context.modelName).toBeUndefined()
  })
})
