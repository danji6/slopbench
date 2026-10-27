import { useSessionSearchPage } from '@/hooks/chat/session-search-page'
import type { SessionGroupPage } from '@/hooks/chat/sessions'
import type { SessionListItem } from '@/lib/chat'
import { afterEach, beforeAll, expect, mock, test } from 'bun:test'
import { StrictMode, act, useLayoutEffect, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupDom } from '~/tests/setup/dom'

setupDom()

let root: Root | null = null
let view: SessionGroupPage
let update: (page: SessionGroupPage) => void
let source: SessionGroupPage
let enabled = true
let identity = 'first'
const requests = mock((_count: number) => {
  update({ ...source, status: 'LoadingMore' })
})

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  requests.mockClear()
  enabled = true
  identity = 'first'
})

function Harness({ initial }: { initial: SessionGroupPage }) {
  const [page, setPage] = useState(initial)
  const result = useSessionSearchPage(page, enabled)
  useLayoutEffect(() => {
    source = page
    update = setPage
    view = result
  }, [page, result])
  return null
}

function items(start: number, count: number): SessionListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    _id: `session-${start + i}` as SessionListItem['_id'],
    _creationTime: start + i,
    owned: true,
    participants: [],
  }))
}

async function render(initial: SessionGroupPage) {
  if (!root) {
    const element = document.createElement('div')
    document.body.append(element)
    root = createRoot(element)
  }
  await act(async () => {
    root!.render(
      <StrictMode>
        <Harness key={identity} initial={initial} />
      </StrictMode>,
    )
  })
}

function initial(results: SessionListItem[] = []): SessionGroupPage {
  return { results, status: 'CanLoadMore', loadMore: requests }
}

async function resolve(count: number, exhausted = false) {
  await act(async () => {
    update({
      ...source,
      results: [...source.results, ...items(source.results.length, count)],
      status: exhausted ? 'Exhausted' : 'CanLoadMore',
    })
  })
}

test('fills the first screen across empty and partial pages', async () => {
  await render(initial())
  expect(view.status).toBe('LoadingFirstPage')
  await resolve(0)
  await resolve(3)
  await resolve(0)
  expect(view.results).toHaveLength(3)
  expect(view.status).toBe('LoadingFirstPage')
  await resolve(18)
  expect(view.results).toHaveLength(21)
  expect(view.status).toBe('CanLoadMore')
  // StrictMode may repeat effects; the real Convex loadMore guards its cursor.
  expect(requests.mock.calls.every(([count]) => count === 20)).toBe(true)
})

test('load more requests twenty additional matches and keeps loading across sparse pages', async () => {
  await render(initial(items(0, 22)))
  expect(requests).not.toHaveBeenCalled()
  await act(async () => {
    view.loadMore(20)
    view.loadMore(20)
  })
  expect(requests).toHaveBeenCalledTimes(1)
  expect(view.status).toBe('LoadingMore')
  await resolve(4)
  await resolve(0)
  expect(source.results).toHaveLength(26)
  expect(view.results).toHaveLength(22)
  expect(view.status).toBe('LoadingMore')
  await resolve(16)
  expect(view.results).toHaveLength(42)
  expect(view.status).toBe('CanLoadMore')
})

test('stops at exhaustion, including a completely empty search', async () => {
  await render(initial())
  await resolve(0, true)
  expect(view.results).toHaveLength(0)
  expect(view.status).toBe('Exhausted')
  const count = requests.mock.calls.length
  await act(async () => view.loadMore(20))
  expect(requests).toHaveBeenCalledTimes(count)
})

test('resets the requested target when the query or visibility identity changes', async () => {
  await render(initial(items(0, 20)))
  await act(async () => view.loadMore(20))
  expect(view.status).toBe('LoadingMore')
  identity = 'second:show-hidden'
  await render(initial(items(100, 20)))
  expect(view.status).toBe('CanLoadMore')
  expect(String(view.results[0]!._id)).toBe('session-100')
  expect(view.results).toHaveLength(20)
})

test('ordinary lists keep their existing manual pagination', async () => {
  enabled = false
  await render(initial(items(0, 5)))
  expect(view.status).toBe('CanLoadMore')
  expect(requests).not.toHaveBeenCalled()
  await act(async () => view.loadMore(7))
  expect(requests).toHaveBeenCalledWith(7)
})
