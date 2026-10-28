import { useMessageWindow } from '@/hooks/chat/message-window'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { WindowMessage } from '@sb/convex/model/chat/queries'
import {
  MESSAGE_PAGE_BUDGET_BYTES,
  MESSAGE_WINDOW_BUDGET_BYTES,
  MESSAGE_WINDOW_MAX_ROWS,
} from '@sb/core/const'
import { afterEach, expect, test } from 'bun:test'
import { ConvexProvider } from 'convex/react'
import { StrictMode, act, useLayoutEffect } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { messageWindowClient } from '~/tests/helpers/message-window-client'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()
let root: Root | null = null
let view: ReturnType<typeof useMessageWindow>
const sessionId = 'session' as Id<'sessions'>
const page: WindowMessage[] = [
  {
    _id: 'm1' as Id<'messages'>,
    _creationTime: 1,
    selectedVersion: 1,
    versionCount: 1,
    role: 'assistant',
    status: 'done',
    sessionId,
    sender: { type: 'agent', id: 'agent' as Id<'agents'> },
    segments: [
      {
        segmentIndex: 4,
        parts: [],
        sizeBytes: MESSAGE_WINDOW_BUDGET_BYTES * 2,
      },
    ],
    sizeBytes: MESSAGE_WINDOW_BUDGET_BYTES * 2,
    hasOlderSegments: true,
    hasNewerSegments: false,
  },
]
const result = () => ({ page, hasOlder: true, hasNewer: false, atTail: true })
let source = messageWindowClient(result)

afterEach(() => {
  act(() => root?.unmount())
  root = null
  source = messageWindowClient(result)
  document.body.innerHTML = ''
})

function Harness() {
  const window = useMessageWindow(sessionId)
  useLayoutEffect(() => {
    view = window
  }, [window])
  return null
}

async function mount() {
  const element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  await act(async () => {
    root!.render(
      <StrictMode>
        <ConvexProvider client={source.client}>
          <Harness />
        </ConvexProvider>
      </StrictMode>,
    )
  })
}

async function settle() {
  for (let frame = 0; frame < 10 && view.meta.isLoadingOlder; frame++) {
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
  }
  expect(view.meta.isLoadingOlder).toBe(false)
}

test('completes cached requests once and keeps growth and slide budgets bounded', async () => {
  await mount()
  for (let i = 1; i <= 5; i++) {
    await act(async () => {
      view.controls.extendOlder()
    })
    await settle()
    expect(view.meta.pageRevision).toBe(i)
  }
  expect(source.calls[0].budgetBytes).toBe(MESSAGE_PAGE_BUDGET_BYTES)
  expect(
    source.calls.every(
      (call) => call.budgetBytes! <= MESSAGE_WINDOW_BUDGET_BYTES,
    ),
  ).toBe(true)
  expect(
    source.calls.every((call) => call.limit <= MESSAGE_WINDOW_MAX_ROWS),
  ).toBe(true)
})

test('strict fallback skips the loaded segment or excludes an exhausted message', async () => {
  await mount()
  const before = {
    _id: 'm1',
    _creationTime: 1,
    segmentIndex: 4,
    selectedVersion: 1,
    hasOlderSegments: true,
  }
  await act(async () => {
    view.controls.extendOlder(before)
  })
  expect(source.calls.at(-1)).toMatchObject({
    anchorSegment: 3,
    anchorInclusive: true,
  })
  await settle()
  await act(async () => {
    view.controls.extendOlder({
      ...before,
      segmentIndex: 0,
      hasOlderSegments: false,
    })
  })
  expect(source.calls.at(-1)).toMatchObject({ anchorInclusive: false })
  expect(source.calls.at(-1)?.anchorSegment).toBeUndefined()
  await settle()
})

test('waits for fresh data and invalidates a pending request on navigation', async () => {
  await mount()
  source.defer()
  await act(async () => {
    view.controls.extendOlder()
  })
  expect(view.meta.pageRevision).toBe(0)
  expect(view.meta.isLoadingOlder).toBe(true)
  await act(async () => {
    view.controls.returnToLatest()
    source.resolve()
  })
  expect(view.meta.navigationRevision).toBe(1)
  expect(view.meta.pageRevision).toBe(0)
  expect(view.meta.isLoadingOlder).toBe(false)
})
