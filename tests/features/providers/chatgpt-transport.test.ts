import { fetchChatGPTResponse } from '@sb/convex/model/provider/openai/transport'
import { afterEach, expect, spyOn, test } from 'bun:test'

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>
afterEach(() => fetchSpy?.mockRestore())

test('cancels an unread response if routing cannot be saved', async () => {
  let cancelled = false
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
    ),
  )
  const ownershipError = new Error('Stale execution')
  await expect(
    fetchChatGPTResponse(
      'https://sidecar.fixture',
      {},
      {
        onResponse: async () => {
          throw ownershipError
        },
      },
    ),
  ).rejects.toBe(ownershipError)
  expect(cancelled).toBe(true)
})

test('preserves network errors even if an observer fails', async () => {
  const networkError = new Error('Fixture connection closed')
  fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(networkError)
  await expect(
    fetchChatGPTResponse(
      'https://sidecar.fixture',
      {},
      {
        onError: async () => {
          throw new Error('Observer unavailable')
        },
      },
    ),
  ).rejects.toBe(networkError)
})

test('preserves cancellation while stripping internal routing headers', async () => {
  let cancelled = false
  const controller = new AbortController()
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    expect(init?.signal).toBe(controller.signal)
    return new Response(
      new ReadableStream({
        cancel() {
          cancelled = true
        },
      }),
      {
        headers: {
          'x-codex-turn-state': 'private-state',
          'x-slopbench-auth-revision': 'private-revision',
          'x-request-id': 'public-request-id',
        },
      },
    )
  }) as typeof fetch)
  const response = await fetchChatGPTResponse('https://sidecar.fixture', {
    signal: controller.signal,
  })
  expect(response.headers.has('x-codex-turn-state')).toBe(false)
  expect(response.headers.has('x-slopbench-auth-revision')).toBe(false)
  expect(response.headers.get('x-request-id')).toBe('public-request-id')
  await response.body?.cancel()
  expect(cancelled).toBe(true)
})
