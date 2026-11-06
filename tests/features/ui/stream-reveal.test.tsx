import {
  useConditionalFollow,
  useConditionalScroll,
} from '@/hooks/chat/message-list/stream-reveal'
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()

type RevealState = {
  messageId: string | null
  autoScroll: boolean
  shouldRevealStream: boolean
}

let root: Root
let state: RevealState
let content: HTMLDivElement
const unlockScroll = mock((_force?: boolean) => {})
const scrollUntilCondition = mock((_condition: () => boolean) => {})

function Harness() {
  useConditionalFollow(state.messageId, state.shouldRevealStream, unlockScroll)
  useConditionalScroll({
    ...state,
    scrollRef: { current: content },
    scrollUntilCondition,
    topPadding: 16,
  })
  return null
}

function render(patch: Partial<RevealState> = {}) {
  state = { ...state, ...patch }
  act(() => root.render(<Harness />))
}

function addMessage(id: string, top: number) {
  const row = document.createElement('div')
  row.dataset.messageId = id
  row.getBoundingClientRect = () => new DOMRect(0, top, 300, 80)
  content.append(row)
  return row
}

beforeEach(() => {
  state = { messageId: null, autoScroll: false, shouldRevealStream: true }
  content = document.createElement('div')
  const host = document.createElement('div')
  document.body.append(content, host)
  root = createRoot(host)
  render()
})

afterEach(() => {
  act(() => root.unmount())
  unlockScroll.mockClear()
  scrollUntilCondition.mockClear()
  document.body.replaceChildren()
})

test.each([true, false])(
  'starts scrolling on visible reply arrival when auto-follow is %s',
  (autoScroll) => {
    render({ autoScroll })
    addMessage('user', 0)
    render()
    expect(unlockScroll).not.toHaveBeenCalled()
    expect(scrollUntilCondition).not.toHaveBeenCalled()

    render({ messageId: 'assistant' })
    expect(unlockScroll).toHaveBeenCalledWith(true)
    expect(scrollUntilCondition).toHaveBeenCalledTimes(autoScroll ? 0 : 1)

    render()
    expect(unlockScroll).toHaveBeenCalledTimes(1)
    expect(scrollUntilCondition).toHaveBeenCalledTimes(autoScroll ? 0 : 1)
  },
)

test('waits for the reply to mount and clear the nav instead of settling on the user message', () => {
  addMessage('user', 0)
  render({ messageId: 'assistant' })
  const condition = scrollUntilCondition.mock.calls[0]![0]
  expect(condition()).toBe(false)

  const reply = addMessage('assistant', 500)
  expect(condition()).toBe(false)
  reply.getBoundingClientRect = () => new DOMRect(0, 64, 300, 80)
  expect(condition()).toBe(true)
})

test.each([true, false])(
  'does not start after scrolling away while waiting when auto-follow is %s',
  (autoScroll) => {
    render({ autoScroll })
    render({ shouldRevealStream: false })
    render({ messageId: 'assistant' })
    expect(unlockScroll).not.toHaveBeenCalled()
    expect(scrollUntilCondition).not.toHaveBeenCalled()

    // Returning to the bottom must not replay a missed reveal.
    render({ shouldRevealStream: true })
    expect(unlockScroll).not.toHaveBeenCalled()
    expect(scrollUntilCondition).not.toHaveBeenCalled()
  },
)

test('reveals the next agent reply in an ongoing stream', () => {
  render({ messageId: 'assistant-1' })
  render({ messageId: 'assistant-2' })
  expect(unlockScroll).toHaveBeenCalledTimes(2)
  expect(scrollUntilCondition).toHaveBeenCalledTimes(2)
})
