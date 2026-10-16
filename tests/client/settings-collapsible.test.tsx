/// <reference types="bun-types" />
import type { SettingsCollapsible as SettingsCollapsibleComponent } from '@/components/ui/settings-collapsible'
import { afterEach, beforeAll, expect, mock, test } from 'bun:test'
import { MotionConfig } from 'motion/react'
import { type ComponentProps, act } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let SettingsCollapsible: typeof SettingsCollapsibleComponent
let root: Root | null = null

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;({ SettingsCollapsible } =
    await import('@/components/ui/settings-collapsible'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(
  props: Partial<ComponentProps<typeof SettingsCollapsible>> = {},
) {
  if (!root) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  act(() => {
    root?.render(
      <MotionConfig skipAnimations>
        <SettingsCollapsible label="Change password" {...props}>
          <input aria-label="Old password" defaultValue="unsaved value" />
        </SettingsCollapsible>
      </MotionConfig>,
    )
  })
  return document.querySelector<HTMLButtonElement>(
    '[data-slot="collapsible-trigger"]',
  )!
}

test('starts collapsed and preserves field values when toggled', () => {
  const trigger = render()
  const content = document.getElementById(
    trigger.getAttribute('aria-controls')!,
  )!
  const field = content.querySelector('input')!
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(content.hasAttribute('inert')).toBe(true)
  expect(document.querySelectorAll('button')).toHaveLength(1)

  act(() => trigger.click())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(content.hasAttribute('inert')).toBe(false)
  field.value = 'edited value'
  act(() => trigger.click())
  act(() => trigger.click())
  expect(content.querySelector('input')).toBe(field)
  expect(field.value).toBe('edited value')
})

test('keeps optional header controls outside the expansion trigger', () => {
  const action = mock(() => {})
  const trigger = render({
    label: 'Ollama',
    actions: <button onClick={action}>Remove provider</button>,
  })
  const remove = [...document.querySelectorAll('button')].find(
    (button) => button.textContent === 'Remove provider',
  )!
  expect(trigger.contains(remove)).toBe(false)
  act(() => remove.click())
  expect(action).toHaveBeenCalledTimes(1)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

test('supports controlled expansion and a disabled trigger', () => {
  const onOpenChange = mock(() => {})
  const trigger = render({ open: false, onOpenChange })
  act(() => trigger.click())
  expect(onOpenChange).toHaveBeenCalledWith(true)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')

  render({ open: true, onOpenChange, disabled: true })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  act(() => trigger.click())
  expect(onOpenChange).toHaveBeenCalledTimes(1)
})
