import type { ScrollDeps } from '@/components/chat/messages/message-list/deps'
import { useFollowEdges } from '@/hooks/chat/message-list/follow-edges'
import { ScrollCoordinator } from '@/lib/scroll-coordinator'
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test'
import { act, useLayoutEffect } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()

let root: Root
let deps: ScrollDeps
let view: ReturnType<typeof useFollowEdges>
let frames: Map<number, FrameRequestCallback>
let restore: () => void
const unlockScroll = mock(() => {})
const scrollToBottom = mock(() => {})
const noop = () => {}

function Harness() {
  const value = useFollowEdges(deps, {
    returnToLatest: noop,
    returnToOldest: noop,
    status: 'ready',
    isAtLiveTail: deps.metaRef.current.isAtLiveTail,
    canLoadOlder: false,
    rows: [],
    setFollowOverride: noop,
  })
  useLayoutEffect(() => {
    view = value
  }, [value])
  return null
}

beforeEach(() => {
  frames = new Map()
  let nextFrame = 0
  const request = spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
    (callback) => {
      frames.set(++nextFrame, callback)
      return nextFrame
    },
  )
  const cancel = spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(
    (id) => {
      frames.delete(id)
    },
  )
  restore = () => {
    request.mockRestore()
    cancel.mockRestore()
  }
  deps = {
    scroller: {
      coordinator: new ScrollCoordinator(),
      scrollToBottom,
      unlockScroll,
      holdPosition: noop,
    } as unknown as ScrollDeps['scroller'],
    docScrollRef: { current: { scrollHeight: window.innerHeight } },
    metaRef: {
      current: {
        canLoadOlder: false,
        canLoadNewer: true,
        isAtLiveTail: false,
        isLoadingOlder: false,
        isLoadingNewer: false,
      },
    },
  } as ScrollDeps
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
  restore()
  unlockScroll.mockClear()
  scrollToBottom.mockClear()
  document.body.replaceChildren()
})

function advanceFrame() {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(performance.now())
}

test('reloading the live tail restarts settling without releasing navigation early', () => {
  act(() => view.followToBottom())
  advanceFrame()
  deps.metaRef.current.isAtLiveTail = true
  act(() => root.render(<Harness />))

  expect(deps.scroller.coordinator.kind).toBe('navigate')
  expect(unlockScroll).not.toHaveBeenCalled()
  for (let i = 0; i < 3; i++) advanceFrame()
  expect(deps.scroller.coordinator.kind).toBeNull()
  expect(unlockScroll).toHaveBeenCalledTimes(1)
})

test('interrupting a bottom jump cancels settling without resuming follow', () => {
  const contentReady = deps.scroller.coordinator.trackPendingLayout()
  act(() => view.followToBottom())
  deps.scroller.coordinator.interrupt()
  contentReady()
  advanceFrame()
  expect(frames.size).toBe(0)
  expect(unlockScroll).not.toHaveBeenCalled()
})

test('waits for mounted asynchronous content before handing navigation to follow', () => {
  deps.metaRef.current.isAtLiveTail = true
  const summaryReady = deps.scroller.coordinator.trackPendingLayout()
  act(() => view.followToBottom())
  for (let i = 0; i < 5; i++) advanceFrame()
  expect(unlockScroll).not.toHaveBeenCalled()

  const filesReady = deps.scroller.coordinator.trackPendingLayout()
  summaryReady()
  for (let i = 0; i < 5; i++) advanceFrame()
  expect(unlockScroll).not.toHaveBeenCalled()

  filesReady()
  for (let i = 0; i < 3; i++) advanceFrame()
  expect(unlockScroll).toHaveBeenCalledTimes(1)
})
