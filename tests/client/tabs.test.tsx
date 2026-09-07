/// <reference types="bun-types" />
import type * as TabsTypes from '@/components/ui/tabs'
import { afterEach, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let tabs: typeof TabsTypes
let root: Root | null = null
const resizeCallbacks = new Set<() => void>()
let originalResizeObserver: typeof ResizeObserver

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  tabs = await import('@/components/ui/tabs')
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  globalThis.ResizeObserver = originalResizeObserver
  resizeCallbacks.clear()
})

function mockLayout(element: HTMLElement, left: number, width: number) {
  for (const [name, value] of Object.entries({
    offsetLeft: left,
    offsetTop: 0,
    offsetWidth: width,
    offsetHeight: 48,
    scrollWidth: width,
    scrollHeight: 48,
  })) {
    Object.defineProperty(element, name, { configurable: true, value })
  }
  element.getBoundingClientRect = () => new DOMRect(left, 0, width, 48)
}

async function resize() {
  await act(async () => {
    resizeCallbacks.forEach((callback) => callback())
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

test('indicator follows layout changes after mount without changing tabs', async () => {
  originalResizeObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      this.callback = callback
      resizeCallbacks.add(callback)
    }
    callback: () => void
    observe() {}
    unobserve() {}
    disconnect() {
      resizeCallbacks.delete(this.callback)
    }
  } as unknown as typeof ResizeObserver

  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <tabs.Tabs value="tools" variant="hug">
        <tabs.Tabs.List>
          <tabs.Tabs.Trigger value="tools">Tools</tabs.Tabs.Trigger>
          <tabs.Tabs.Trigger value="mcp">MCP</tabs.Tabs.Trigger>
          <tabs.Tabs.Trigger value="approvals">Approvals</tabs.Tabs.Trigger>
        </tabs.Tabs.List>
      </tabs.Tabs>,
    )
  })

  const list = container.querySelector<HTMLElement>('[role="tablist"]')!
  const triggers = container.querySelectorAll<HTMLElement>('[role="tab"]')
  const indicator = list.querySelector<HTMLElement>('[role="presentation"]')!
  expect(indicator.hidden).toBe(true)

  for (const width of [600, 900, 360]) {
    mockLayout(list, 0, width)
    triggers.forEach((trigger, index) => {
      mockLayout(trigger, (index * width) / 3, width / 3)
    })
    await resize()
    expect(indicator.hidden).toBe(false)
    expect(indicator.style.left).toBe('0px')
    expect(indicator.style.right).toBe(`${(width * 2) / 3}px`)
    expect(indicator.style.top).toBe('45px')
    expect(indicator.style.bottom).toBe('0px')
  }
})
