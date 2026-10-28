import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { useScrollPersistence } from '@/hooks/chat/message-list/scroll-persistence'
import type { SeekTargetOptions } from '@/hooks/chat/message-list/seek'
import { createMessageStore } from '@/lib/chat/message-store'
import {
  clearSavedScroll,
  getSavedScroll,
  setSavedScroll,
} from '@/lib/chat/scroll-position-store'
import { ScrollCoordinator } from '@/lib/scroll-coordinator'
import { afterEach, expect, mock, test } from 'bun:test'
import { act, useLayoutEffect } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { entry, syncPage } from '~/tests/helpers/older-pages'
import { tool } from '~/tests/helpers/work-layout'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()
const sessionId = 'persistence-test'
let root: Root | null = null
let store = createMessageStore()
let coordinator = new ScrollCoordinator()
let positioning = false
let view: ReturnType<typeof useScrollPersistence>
let deps: ScrollDeps
const request = mock(
  (
    _id: string,
    _time?: number,
    _segment?: number,
    _options?: SeekTargetOptions,
  ) => {},
)
const noop = () => {}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
  clearSavedScroll(sessionId)
  store = createMessageStore()
  coordinator = new ScrollCoordinator()
  positioning = false
  request.mockClear()
})

function Harness() {
  const value = useScrollPersistence(deps, {
    sessionId,
    messageStore: store,
    isAtBottom: false,
    requestScrollToMessage: request,
    followToBottom: noop,
    onRestoreSettled: noop,
    isPositioning: positioning,
  })
  useLayoutEffect(() => {
    view = value
  }, [value])
  return null
}

async function mount() {
  syncPage(store, [entry(1, [tool('read_file', 'retained')], 4)])
  deps = {
    rowsRef: { current: store.getRows() },
    metaRef: { current: store.getWindowMetadata() },
    topPadding: 16,
    scroller: { coordinator } as ScrollDeps['scroller'],
    virtuaRef: { current: null },
    docScrollRef: { current: document.documentElement },
  }
  const row = store.getRows().find((row) => row.kind === 'work')!
  const item = document.createElement('div')
  item.dataset.rowKey = row.key
  const content = document.createElement('button')
  content.getBoundingClientRect = () => new DOMRect(0, 100, 300, 48)
  item.append(content)
  document.body.append(item)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await render()
}

async function render() {
  await act(async () => {
    root!.render(<Harness />)
  })
}

function saveLeaving() {
  window.dispatchEvent(new Event('pagehide'))
}

test('saves a collapsed tool address on pagehide and restores its content offset', async () => {
  await mount()
  expect(view.restore()).toBe(false)
  saveLeaving()
  const saved = getSavedScroll(sessionId)!
  expect(saved.rowAddress).toEqual({
    kind: 'work',
    segmentIndex: 4,
    toolCallId: 'retained',
  })
  expect(saved.segmentIndex).toBe(4)
  expect(saved.offset).toBe(36)
  expect(saved.contentOffset).toBe(true)
  expect(view.restore()).toBe(true)
  saveLeaving()
  expect(getSavedScroll(sessionId)).toBe(saved)
  expect(request.mock.lastCall?.slice(0, 3)).toEqual(['m1', 1, 4])
  expect(request.mock.lastCall?.[3]).toMatchObject({
    rowAddress: saved.rowAddress,
    contentOffset: true,
    offset: 36,
  })
})

test('keeps the last settled position while loading, positioning, or restoring', async () => {
  await mount()
  view.restore()
  saveLeaving()
  const saved = getSavedScroll(sessionId)!
  deps.metaRef.current = { ...deps.metaRef.current, isLoadingOlder: true }
  saveLeaving()
  expect(getSavedScroll(sessionId)).toBe(saved)
  deps.metaRef.current = {
    ...deps.metaRef.current,
    isLoadingOlder: false,
    isLoadingNewer: true,
  }
  saveLeaving()
  expect(getSavedScroll(sessionId)).toBe(saved)
  deps.metaRef.current = { ...deps.metaRef.current, isLoadingNewer: false }
  positioning = true
  await render()
  saveLeaving()
  expect(getSavedScroll(sessionId)).toBe(saved)
  positioning = false
  await render()
  coordinator.begin('restore')
  saveLeaving()
  expect(getSavedScroll(sessionId)).toBe(saved)
})

test('preserves compatibility with saved row keys from before content addresses', async () => {
  await mount()
  setSavedScroll(sessionId, {
    anchorId: 'm1',
    creationTime: 1,
    rowKey: 'h:m1',
    offset: 12,
    following: false,
  })
  expect(view.restore()).toBe(true)
  expect(request.mock.lastCall?.[3]).toMatchObject({
    rowKey: 'h:m1',
    offset: 12,
    rowAddress: undefined,
    contentOffset: undefined,
  })
})
