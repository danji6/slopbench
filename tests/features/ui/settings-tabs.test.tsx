/// <reference types="bun-types" />
import type * as SettingsTabsTypes from '@/components/ui/settings-tabs'
import { afterEach, beforeAll, beforeEach, expect, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupDom } from '~/tests/setup/dom'

setupDom()

let settingsTabs: typeof SettingsTabsTypes
let root: Root | null = null
let originalGetAnimations: typeof HTMLElement.prototype.getAnimations

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  settingsTabs = await import('@/components/ui/settings-tabs')
})

beforeEach(() => {
  originalGetAnimations = HTMLElement.prototype.getAnimations
  // Keep Base UI's outgoing panels mounted, as during an interrupted fade.
  HTMLElement.prototype.getAnimations = () =>
    [{ finished: new Promise(() => {}) }] as Animation[]
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  HTMLElement.prototype.getAnimations = originalGetAnimations
})

test.each([false, true])(
  'only the selected settings panel is visible during rapid switches (keepMounted=%s)',
  async (keepMounted) => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const values = ['profile', 'tools', 'skills']

    for (const value of ['profile', 'tools', 'skills', 'tools', 'profile']) {
      await act(async () => {
        root?.render(
          <settingsTabs.SettingsTabs value={value}>
            {values.map((panelValue) => (
              <settingsTabs.SettingsTabs.Content
                key={panelValue}
                value={panelValue}
                keepMounted={keepMounted}
              >
                {panelValue}
              </settingsTabs.SettingsTabs.Content>
            ))}
          </settingsTabs.SettingsTabs>,
        )
      })

      const visiblePanels = container.querySelectorAll(
        '[role="tabpanel"]:not([hidden])',
      )
      expect(visiblePanels).toHaveLength(1)
      expect(visiblePanels[0]?.textContent).toBe(value)
    }
  },
)
