/// <reference types="bun-types" />
import { type JobTail, useJobTail } from '@/hooks/chat/terminals'
import * as http from '@/hooks/http'
import type { Id } from '@sb/convex/_generated/dataModel'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()

type Stream = ReadableStreamDefaultController<Uint8Array>
type ReaderProps = { jobId: string; name?: string }

const sessionId = 'tail-test-session' as Id<'sessions'>
let root: Root | null = null
let container: HTMLDivElement
let streams: Stream[]
let restore: Array<() => void> = []

beforeEach(() => {
  streams = []
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const site = spyOn(http, 'convexSiteUrl').mockReturnValue(
    'http://fixture.invalid',
  )
  const token = spyOn(http, 'getConvexToken').mockResolvedValue(undefined)
  const fetchResponse = Object.assign(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller)
          },
        }),
      ),
    { preconnect: globalThis.fetch.preconnect },
  )
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(fetchResponse)
  restore = [
    () => site.mockRestore(),
    () => token.mockRestore(),
    () => fetch.mockRestore(),
  ]
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  restore.forEach((restoreMock) => restoreMock())
  document.body.replaceChildren()
})

function Reader({ jobId, name = 'original' }: ReaderProps) {
  const tail = useJobTail(sessionId, jobId, Boolean(jobId))
  return <pre data-reader={name}>{JSON.stringify(tail)}</pre>
}

function tail(name = 'original'): JobTail {
  const text = container.querySelector(`[data-reader="${name}"]`)?.textContent
  return JSON.parse(text ?? '{}') as JobTail
}

async function send(stream: Stream, event: string, data: unknown) {
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode(
        `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      ),
    )
  })
}

test('each reader receives identical output and completion for the same job', async () => {
  await act(async () => {
    root?.render(
      <>
        <Reader jobId="shared-background-job" />
        <Reader jobId="shared-background-job" name="output-read" />
      </>,
    )
  })
  expect(streams).toHaveLength(2)

  for (const stream of streams) {
    await send(stream, 'meta', { background: true, waiting: false })
  }
  for (const stream of streams) {
    await send(stream, 'chunk', { text: 'job output', nextOffset: 10 })
  }
  for (const name of ['original', 'output-read']) {
    expect(tail(name)).toMatchObject({
      term: 'job output',
      status: 'background',
    })
  }

  for (const stream of streams) {
    await send(stream, 'end', { status: 'done' })
  }
  for (const name of ['original', 'output-read']) {
    expect(tail(name)).toMatchObject({ term: 'job output', status: 'done' })
  }
})

test('a reader that learns its job id adopts the cached tail and clears it for a different job', async () => {
  await act(async () => {
    root?.render(<Reader key="seed" jobId="cached-background-job" />)
  })
  await send(streams[0], 'chunk', { text: 'cached output', nextOffset: 113 })
  await send(streams[0], 'end', { status: 'done' })

  await act(async () => {
    root?.render(<Reader key="late" jobId="" />)
  })
  expect(tail().term).toBe('')
  await act(async () => {
    root?.render(<Reader key="late" jobId="cached-background-job" />)
  })
  expect(tail()).toMatchObject({
    term: 'cached output',
    termOffset: 100,
    status: 'done',
  })

  // An identical replay must still reach this reader's own state.
  await send(streams[1], 'chunk', { text: 'cached output', nextOffset: 113 })
  await send(streams[1], 'end', { status: 'done' })
  expect(tail()).toMatchObject({
    term: 'cached output',
    termOffset: 100,
    status: 'done',
  })

  await act(async () => {
    root?.render(<Reader key="late" jobId="uncached-background-job" />)
  })
  expect(tail().term).toBe('')
  expect(tail().status).toBeUndefined()
  await send(streams[2], 'chunk', { text: 'new output', nextOffset: 10 })
  await send(streams[2], 'end', { status: 'done' })
  expect(tail()).toMatchObject({
    term: 'new output',
    termOffset: 0,
    status: 'done',
  })
})

test('ignores a response from the previous job after switching jobs', async () => {
  let resolveResponse: (response: Response) => void = () => {}
  const pending = new Promise<Response>((resolve) => {
    resolveResponse = resolve
  })
  const fetch = spyOn(globalThis, 'fetch').mockReturnValueOnce(pending)
  await act(async () => {
    root?.render(<Reader jobId="previous-background-job" />)
  })
  const oldSignal = fetch.mock.calls[0][1]?.signal
  await act(async () => {
    root?.render(<Reader jobId="current-background-job" />)
  })
  expect(oldSignal?.aborted).toBe(true)
  await send(streams[0], 'meta', { background: true })
  await send(streams[0], 'chunk', { text: 'current output', nextOffset: 14 })

  await act(async () => {
    resolveResponse(new Response(null, { status: 404 }))
  })
  expect(tail()).toMatchObject({ term: 'current output', status: 'background' })
  await send(streams[0], 'end', { status: 'done' })
  expect(tail().status).toBe('done')
})
