import { ElementScrollTarget } from '@/lib/scroll-target'
import { Scroller } from '@/lib/scroller'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

let scroller: Scroller
let content: HTMLDivElement
let scrollHeight: number
let mutate: () => void
let resize: () => void
let intersect: () => void
let restore: () => void

function mockContentObservers() {
  const originalMutation = globalThis.MutationObserver
  const originalResize = globalThis.ResizeObserver
  globalThis.MutationObserver = class {
    constructor(callback: MutationCallback) {
      mutate = () => callback([], this)
    }
    observe() {}
    disconnect() {}
    takeRecords = () => []
  }
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resize = () => callback([], this)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  return () => {
    globalThis.MutationObserver = originalMutation
    globalThis.ResizeObserver = originalResize
  }
}

function mockIntersectionObserver() {
  const original = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = () =>
        callback([{ isIntersecting: true } as IntersectionObserverEntry], this)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords = () => []
    root = null
    rootMargin = ''
    scrollMargin = ''
    thresholds = [0]
  }
  return () => {
    globalThis.IntersectionObserver = original
  }
}

function mockScrollObservers() {
  const restoreContent = mockContentObservers()
  const restoreIntersection = mockIntersectionObserver()
  const animation = spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(
    1,
  )
  const cancel = spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(
    () => {},
  )
  return () => {
    restoreContent()
    restoreIntersection()
    animation.mockRestore()
    cancel.mockRestore()
  }
}

beforeEach(async () => {
  content = document.createElement('div')
  scrollHeight = 2000
  Object.defineProperties(content, {
    scrollHeight: { get: () => scrollHeight },
    clientHeight: { value: 800 },
  })
  restore = mockScrollObservers()
  scroller = new Scroller({ bottomInset: 200 })
  scroller.setElements(
    new ElementScrollTarget(content),
    content,
    document.createElement('div'),
  )
  scroller.setReady(true)
  await Promise.resolve()
})

afterEach(() => {
  scroller.dispose()
  restore()
})

describe('streaming scroll holds', () => {
  test.each(['mutation', 'resize'] as const)(
    'expanding thinking and scrolling stays put on the next %s before sentinel observation',
    (event) => {
      scroller.holdPosition()
      scroller.shiftInProgress = true
      scrollHeight += 1000
      scroller.shiftInProgress = false
      content.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
      content.scrollTop = 900
      scrollHeight += 20
      if (event === 'mutation') mutate()
      else resize()
      expect(content.scrollTop).toBe(900)
      expect(scroller.autoScrolling).toBe(false)
    },
  )

  test('scrolling up before sentinel observation cancels the initial snap', () => {
    content.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
    content.scrollTop = 900
    scrollHeight += 20
    mutate()
    expect(content.scrollTop).toBe(900)
  })

  test('holding after sentinel observation still blocks streamed growth', async () => {
    intersect()
    await Promise.resolve()
    scroller.holdPosition()
    content.scrollTop = 900
    scrollHeight += 20
    mutate()
    expect(content.scrollTop).toBe(900)
    expect(scroller.autoScrolling).toBe(false)
  })
})

describe('keyboard bottom compensation', () => {
  test.each([true, false])(
    'keeps the tail visible when follow is %s',
    (enabled) => {
      scroller.enabled = enabled
      scrollHeight += 300
      scroller.setBottomInset(500)
      expect(content.scrollTop).toBe(1500)
    },
  )

  test('preserves a position earlier in history', () => {
    content.scrollTop = 600
    scrollHeight += 300
    scroller.setBottomInset(500)
    expect(content.scrollTop).toBe(600)
  })

  test('does not compensate twice when the browser already scrolled', () => {
    scrollHeight += 300
    content.scrollTop = 1500
    scroller.setBottomInset(500)
    expect(content.scrollTop).toBe(1500)
  })

  test('honors an explicit hold near the bottom', () => {
    scroller.holdPosition()
    scrollHeight += 300
    scroller.setBottomInset(500)
    expect(content.scrollTop).toBe(1200)
  })
})
