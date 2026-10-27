import type * as ViewHooks from '@/hooks/view'
import { afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupDom } from '~/tests/setup/dom'

setupDom()

let hooks: typeof ViewHooks
let root: Root | null = null

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  const dom = window as unknown as {
    happyDOM: { setURL: (url: string) => void }
  }
  dom.happyDOM.setURL('http://localhost/')
  hooks = await import('@/hooks/view')
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

test.each([
  ['settings', 'skills', 'agent', 'profile'],
  ['agent', 'tools', 'settings', 'user'],
])(
  'switches %s:%s to %s:%s without stacking dialogs',
  (source, tab, target, next) => {
    window.history.replaceState(
      null,
      '',
      `/?id=session-1&view=library/${source}:${tab}/prompt:edit`,
    )
    let view: ViewHooks.ViewHandle
    function Probe() {
      view = hooks.useView(source)
      const destination = hooks.useView(target)
      return (
        <output>{JSON.stringify([view.active, destination.active])}</output>
      )
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root?.render(<Probe />))
    expect(container.textContent).toBe('[true,false]')

    const push = spyOn(window.history, 'pushState')
    try {
      act(() => view.switchTo(target, next))
      expect(window.location.search).toBe(
        `?id=session-1&view=library/${target}:${next}`,
      )
      expect(container.textContent).toBe('[false,true]')
      expect(push).toHaveBeenCalledTimes(1)
    } finally {
      push.mockRestore()
    }
  },
)
