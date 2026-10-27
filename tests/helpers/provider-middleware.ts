import type { LanguageModelV3, LanguageModelV4Prompt } from '@ai-sdk/provider'

export function captureFetch(bodies: Record<string, unknown>[]) {
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return fetch as typeof globalThis.fetch
}

export function captureStreamFetch(bodies: Record<string, unknown>[]) {
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  return fetch as typeof globalThis.fetch
}

export function captureStreamRequests(
  requests: Array<{ url: string; body: Record<string, unknown> }>,
) {
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  return fetch as typeof globalThis.fetch
}

export function captureQwenReasoningFetch(
  bodies: Record<string, unknown>[],
  urls: string[],
) {
  const events = [
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'model-latest',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', reasoning_content: 'because' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'model-latest',
      choices: [
        { index: 0, delta: { content: 'Answer' }, finish_reason: null },
      ],
    },
    {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'model-latest',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ]
  const data = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`

  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input))
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    // Some compatible gateways omit the standard SSE content type.
    return new Response(data, { status: 200 })
  }
  return fetch as typeof globalThis.fetch
}

export function captureRequest(requests: RequestInit[]) {
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {})
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return fetch as typeof globalThis.fetch
}

export function capturingModel(id: string) {
  const state = { calls: 0 }
  const emptyStream = () =>
    new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
  const model = {
    specificationVersion: 'v3',
    provider: 'test',
    modelId: id,
    supportedUrls: {},
    doGenerate: async () => {
      state.calls += 1
      throw new Error('not used')
    },
    doStream: async () => {
      state.calls += 1
      return { stream: emptyStream(), request: {}, response: {} }
    },
  } as unknown as LanguageModelV3
  return {
    model,
    get calls() {
      return state.calls
    },
  }
}

export function videoPrompt(): LanguageModelV4Prompt {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          mediaType: 'video/mp4',
        },
      ],
    },
  ]
}

export function mixedVideoPdfPrompt(): LanguageModelV4Prompt {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          mediaType: 'video/mp4',
        },
        {
          type: 'file',
          data: { type: 'data', data: new Uint8Array([4, 5, 6]) },
          mediaType: 'application/pdf',
        },
      ],
    },
  ]
}
