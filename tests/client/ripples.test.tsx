/// <reference types="bun-types" />
import { useRipples } from '@/hooks/ripples'
import { afterEach, beforeAll, expect, test } from 'bun:test'
import { act, useRef } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let root: Root | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 200, 48)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function Harness() {
  const ref = useRef<HTMLDivElement>(null)
  const ripples = useRipples(ref)
  return (
    <div ref={ref} data-testid="row">
      {ripples}
      <div data-ripple-ignore>
        <button type="button">Configure</button>
      </div>
    </div>
  )
}

async function pointerDown(element: Element, pointerId: number) {
  await act(async () => {
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: 10,
        clientY: 10,
        pointerId,
        pointerType: 'mouse',
      }),
    )
  })
}

test('nested action areas do not trigger their containing ripple', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))

  const row = container.querySelector('[data-testid="row"]')!
  await pointerDown(container.querySelector('button')!, 1)
  expect(row.querySelector('span')).toBeNull()

  await pointerDown(row, 2)
  expect(row.querySelector('span')).not.toBeNull()
})
