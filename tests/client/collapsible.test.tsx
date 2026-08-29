/// <reference types="bun-types" />
import type * as CollapsibleTypes from '@/components/ui/collapsible'
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let collapsible: typeof CollapsibleTypes
let root: Root | null = null

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  collapsible = await import('@/components/ui/collapsible')
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(open: boolean, unmountOnClose = true) {
  let container = document.querySelector<HTMLDivElement>('#root')
  if (!container) {
    container = document.createElement('div')
    container.id = 'root'
    document.body.append(container)
    root = createRoot(container)
  }

  act(() => {
    root?.render(
      <collapsible.Collapsible open={open}>
        <collapsible.Collapsible.Content unmountOnClose={unmountOnClose}>
          <div data-testid="expensive-content" />
        </collapsible.Collapsible.Content>
      </collapsible.Collapsible>,
    )
  })
  return container
}

function finishCollapse(container: HTMLDivElement) {
  const content = container.querySelector('[data-slot="collapsible-content"]')
  const event = new Event('transitionend', { bubbles: true })
  Object.defineProperty(event, 'propertyName', {
    value: 'grid-template-rows',
  })
  act(() => content?.dispatchEvent(event))
}

describe('Collapsible.Content', () => {
  test('optionally mounts on open and unmounts after the close transition', () => {
    const container = render(false)
    expect(
      container.querySelector('[data-testid="expensive-content"]'),
    ).toBeNull()

    render(true)
    expect(
      container.querySelector('[data-testid="expensive-content"]'),
    ).not.toBeNull()

    render(false)
    expect(
      container.querySelector('[data-testid="expensive-content"]'),
    ).not.toBeNull()

    finishCollapse(container)
    expect(
      container.querySelector('[data-testid="expensive-content"]'),
    ).toBeNull()
  })

  test('keeps closed content mounted by default', () => {
    const container = render(false, false)
    expect(
      container.querySelector('[data-testid="expensive-content"]'),
    ).not.toBeNull()
  })
})
