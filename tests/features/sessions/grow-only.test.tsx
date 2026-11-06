import { GrowOnly, useGrowOnly } from '@/components/chat/messages/grow-only'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { act, useLayoutEffect } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()

let root: Root | undefined
let height = 100
let controls: NonNullable<ReturnType<typeof useGrowOnly>>
let resize: () => void
let restoreMeasurements: () => void
let restoreGlobals: () => void
const frames = new Map<number, FrameRequestCallback>()

beforeEach(() => {
  height = 100
  let frameId = 0
  const originals = {
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  }
  Object.assign(globalThis, {
    ResizeObserver: class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback)
      return frameId
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  restoreGlobals = () => Object.assign(globalThis, originals)
  const measurements = spyOn(
    HTMLElement.prototype,
    'getBoundingClientRect',
  ).mockImplementation(() => new DOMRect(0, 0, 200, height))
  restoreMeasurements = () => measurements.mockRestore()
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  frames.clear()
  restoreMeasurements()
  restoreGlobals()
  document.body.innerHTML = ''
})

function Controls() {
  const value = useGrowOnly()!
  useLayoutEffect(() => {
    controls = value
  }, [value])
  return null
}

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      <GrowOnly>
        <Controls />
      </GrowOnly>,
    ),
  )
  return container.firstElementChild as HTMLElement
}

function flushFrame() {
  const callbacks = [...frames.values()]
  frames.clear()
  act(() => {
    for (const callback of callbacks) callback(0)
  })
}

test('shrink completion measures the committed content and restores growth protection', () => {
  const row = render()
  expect(row.style.minHeight).toBe('100px')
  act(() => controls.release())
  expect(frames.size).toBe(1)
  let finish!: () => void
  act(() => {
    finish = controls.beginShrink()
  })
  expect(row.style.minHeight).toBe('')

  act(() => controls.release())
  flushFrame()
  expect(row.style.minHeight).toBe('')
  finish()
  height = 30
  flushFrame()
  expect(row.style.minHeight).toBe('30px')

  height = 10
  act(() => resize())
  expect(row.style.minHeight).toBe('30px')
  height = 50
  act(() => resize())
  expect(row.style.minHeight).toBe('50px')
})

test('overlapping shrinks remain independent and completion is idempotent', () => {
  const row = render()
  let first!: () => void
  let second!: () => void
  act(() => {
    first = controls.beginShrink()
    second = controls.beginShrink()
  })
  first()
  first()
  height = 60
  flushFrame()
  act(() => resize())
  expect(row.style.minHeight).toBe('')

  second()
  height = 30
  flushFrame()
  expect(row.style.minHeight).toBe('30px')
  first()
  second()
  expect(frames.size).toBe(0)
})

test('unmount cancels pending shrink completion', () => {
  render()
  let finish!: () => void
  act(() => {
    finish = controls.beginShrink()
  })
  finish()
  expect(frames.size).toBe(1)
  act(() => root!.unmount())
  root = undefined
  expect(frames.size).toBe(0)
})
