/// <reference types="bun-types" />
import type * as QuickTooltipTypes from '@/components/ui/quick-tooltip'
import type * as TooltipTypes from '@/components/ui/tooltip'
import { afterEach, beforeAll, expect, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let tooltip: typeof TooltipTypes
let quickTooltip: typeof QuickTooltipTypes
let root: Root | null = null

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  tooltip = await import('@/components/ui/tooltip')
  quickTooltip = await import('@/components/ui/quick-tooltip')
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function pointerEvent(type: string, options: Partial<PointerEventInit> = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
    pointerType: 'touch',
    ...options,
  })
}

async function wait(milliseconds: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds))
  })
}

function mountTooltip(onClick = () => {}) {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  act(() => {
    root?.render(
      <tooltip.Tooltip longPress longPressDelay={20} longPressCloseDelay={30}>
        <tooltip.Tooltip.Trigger
          render={<button onClick={onClick}>Help</button>}
        />
      </tooltip.Tooltip>,
    )
  })

  return container.querySelector('button')!
}

test('opens after a touch hold and suppresses its release click', async () => {
  let clicks = 0
  const trigger = mountTooltip(() => clicks++)

  act(() => {
    trigger.dispatchEvent(pointerEvent('pointerdown'))
    trigger.focus()
  })
  expect(trigger.hasAttribute('data-popup-open')).toBe(false)

  await wait(25)
  expect(trigger.hasAttribute('data-popup-open')).toBe(true)

  act(() => {
    trigger.dispatchEvent(pointerEvent('pointerup'))
    trigger.click()
  })
  expect(clicks).toBe(0)
  expect(trigger.hasAttribute('data-popup-open')).toBe(true)

  await wait(35)
  expect(trigger.hasAttribute('data-popup-open')).toBe(false)
})

test('leaves a short tap and its click unchanged', async () => {
  let clicks = 0
  const trigger = mountTooltip(() => clicks++)

  act(() => {
    trigger.dispatchEvent(pointerEvent('pointerdown'))
    trigger.dispatchEvent(pointerEvent('pointerup'))
    trigger.click()
  })
  await wait(25)

  expect(clicks).toBe(1)
  expect(trigger.hasAttribute('data-popup-open')).toBe(false)
})

test('cancels a pending long press when the finger moves', async () => {
  const trigger = mountTooltip()

  act(() => {
    trigger.dispatchEvent(pointerEvent('pointerdown'))
    trigger.dispatchEvent(
      pointerEvent('pointermove', { clientX: 25, clientY: 10 }),
    )
  })
  await wait(25)

  expect(trigger.hasAttribute('data-popup-open')).toBe(false)
})

test('closes an open long-press tooltip when scrolling starts', async () => {
  const trigger = mountTooltip()

  act(() => trigger.dispatchEvent(pointerEvent('pointerdown')))
  await wait(25)
  expect(trigger.hasAttribute('data-popup-open')).toBe(true)

  act(() => window.dispatchEvent(new Event('scroll')))
  expect(trigger.hasAttribute('data-popup-open')).toBe(false)
})

test('enables long press for quick tooltips by default', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  act(() => {
    root?.render(
      <quickTooltip.QuickTooltip
        text="Help"
        longPressDelay={20}
        longPressCloseDelay={30}
      >
        <button>Help</button>
      </quickTooltip.QuickTooltip>,
    )
  })

  const trigger = container.querySelector('button')!
  act(() => trigger.dispatchEvent(pointerEvent('pointerdown')))
  await wait(25)

  expect(trigger.hasAttribute('data-popup-open')).toBe(true)
})
