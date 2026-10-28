import { useOlderMessagePages } from '@/hooks/chat/message-list/older-pages'
import {
  type MessageWindowMetadata,
  type WindowBoundary,
  createMessageStore,
} from '@/lib/chat/message-store'
import { projectWorkRows } from '@/lib/chat/work-rows'
import { ScrollCoordinator } from '@/lib/scroll-coordinator'
import { afterEach, expect, mock, test } from 'bun:test'
import { StrictMode, act, useLayoutEffect } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { entry, syncPage } from '~/tests/helpers/older-pages'
import { text, tool } from '~/tests/helpers/work-layout'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()
let root: Root | null = null
let store = createMessageStore()
let coordinator = new ScrollCoordinator()
let sessionId = 'session'
let revision = 0
let view: ReturnType<typeof useOlderMessagePages>
const request = mock((_before?: WindowBoundary) => false)
const cancelled = mock(() => {})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  store = createMessageStore()
  coordinator = new ScrollCoordinator()
  sessionId = 'session'
  revision = 0
  request.mockClear()
  cancelled.mockClear()
})

function Harness() {
  const rows = projectWorkRows(store.getRows(), {
    open: new Set(),
    jobs: [],
    getMessage: store.getMessage,
    getMetadata: store.getMessageMetadata,
  })
  const result = useOlderMessagePages({
    sessionId,
    rows,
    store,
    coordinator,
    meta: store.getWindowMetadata(),
    extendOlder: request,
    onCancel: cancelled,
  })
  useLayoutEffect(() => {
    view = result
  }, [result])
  return null
}

async function renderPage(
  entries: ReturnType<typeof entry>[],
  meta: Partial<MessageWindowMetadata> = {},
) {
  syncPage(store, entries, { pageRevision: revision, ...meta })
  if (!root) {
    const element = document.createElement('div')
    document.body.append(element)
    root = createRoot(element)
  }
  await act(async () => {
    root!.render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    )
  })
}

async function start() {
  await renderPage([entry(5, [text('existing text')])])
  await act(async () => {
    view.loadOlder()
    view.loadOlder()
  })
  expect(request).toHaveBeenCalledTimes(1)
  expect(view.isLoadingOlder).toBe(true)
}

async function resolve(
  entries: ReturnType<typeof entry>[],
  meta: Partial<MessageWindowMetadata> = {},
) {
  revision++
  await renderPage(entries, meta)
}

test('one action continues across collapsed pages and stops at new visible content', async () => {
  await start()
  await resolve([
    entry(4, [tool('shell', 'a')]),
    entry(5, [text('existing text')]),
  ])
  expect(view.isLoadingOlder).toBe(true)
  await resolve([entry(3, [tool('read_file', 'b')])])
  expect(request).toHaveBeenCalledTimes(3)
  await resolve([entry(2, [text('older content')])])
  expect(view.isLoadingOlder).toBe(false)
  expect(request).toHaveBeenCalledTimes(3)
})

test('retries a stalled boundary strictly, and stops if the strict request also stalls', async () => {
  await start()
  await resolve([entry(5, [text('existing text')])])
  expect(request.mock.calls[1]?.[0]).toMatchObject({
    _id: 'm5',
    segmentIndex: 0,
  })
  await resolve([entry(5, [text('existing text')])])
  expect(request).toHaveBeenCalledTimes(2)
  expect(view.isLoadingOlder).toBe(false)
})

test('a boundary shifted by live updates cannot move the strict cutoff forward', async () => {
  await start()
  await resolve([entry(6, [tool('shell', 'a')])])
  expect(request.mock.calls[1]?.[0]?._id).toBe('m5')
  await resolve([entry(4, [text('older content')])])
  expect(view.isLoadingOlder).toBe(false)
})

test('stops at exhaustion even when only collapsed work was loaded', async () => {
  await start()
  await resolve([entry(1, [tool('shell', 'a')])], { canLoadOlder: false })
  expect(view.isLoadingOlder).toBe(false)
  expect(request).toHaveBeenCalledTimes(1)
})

test('live updates and pending requests do not trigger extra loads', async () => {
  await start()
  await renderPage([entry(5, [text('updated text')])])
  await renderPage([entry(4, [tool('shell', 'a')])], { isLoadingOlder: true })
  expect(request).toHaveBeenCalledTimes(1)
  await resolve([entry(4, [tool('shell', 'a')])])
  expect(request).toHaveBeenCalledTimes(2)
})

test.each([
  'session',
  'navigation',
  'version',
  'wheel',
  'pointerdown',
  'checkpoint',
])('cancels on %s and ignores stale completions', async (reason) => {
  await start()
  const entries = [entry(5, [text('existing text')])]
  const meta: Partial<MessageWindowMetadata> = {}
  if (reason === 'session') sessionId = 'other'
  if (reason === 'navigation') meta.navigationRevision = 1
  if (reason === 'version') entries[0].record.selectedVersion = 2
  if (reason === 'checkpoint') coordinator.interrupt()
  if (reason === 'wheel' || reason === 'pointerdown') {
    await act(async () => {
      window.dispatchEvent(new Event(reason))
    })
  }
  await renderPage(entries, meta)
  expect(view.isLoadingOlder).toBe(false)
  expect(cancelled).toHaveBeenCalledTimes(1)
  await resolve([entry(4, [tool('shell', 'a')])], meta)
  expect(request).toHaveBeenCalledTimes(1)
})
