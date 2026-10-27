import type { SessionTree as SessionTreeComponent } from '@/components/chat/sessions/session-tree'
import type * as SessionHooks from '@/hooks/chat/sessions'
import { afterEach, beforeAll, expect, spyOn, test } from 'bun:test'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

let SessionTree: typeof SessionTreeComponent
let SessionStoreProvider: typeof SessionHooks.SessionStoreProvider
let root: Root | null = null

// Keep queries loading without a network connection; rendering still publishes pages.
const client = {
  watchQuery: () => ({
    onUpdate: () => () => {},
    localQueryResult: () => undefined,
  }),
} as unknown as ConvexReactClient

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;({ SessionTree } = await import('@/components/chat/sessions/session-tree'))
  ;({ SessionStoreProvider } = await import('@/hooks/chat/sessions'))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

async function render(search = '') {
  if (!root) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const groupKey = search.trim() ? 'search' : 'ungrouped'
  await act(async () => {
    root!.render(
      <ConvexProvider client={client}>
        <SessionStoreProvider>
          <SessionTree
            rows={[{ kind: 'session', key: groupKey, id: 'chat' }]}
            collapsed={{}}
            renderRow={() => <span>Test chat</span>}
            search={search}
            pages={{}}
            dragging={false}
          />
        </SessionStoreProvider>
      </ConvexProvider>,
    )
  })
}

test('keeps query and page identities distinct through search and sidebar reopening', async () => {
  const errors = spyOn(console, 'error')
  try {
    for (const search of ['', 'chat', 'other', '   ', '']) {
      await render(search)
      const groupKey = search.trim() ? 'search' : 'ungrouped'
      expect(document.querySelectorAll('[data-session-page]')).toHaveLength(1)
      expect(
        document.querySelector(`[data-session-page="${groupKey}"]`)
          ?.textContent,
      ).toBe('Test chat')
    }
    act(() => root!.render(null))
    await render()
    expect(document.querySelectorAll('[data-session-page]')).toHaveLength(1)
    const keyWarnings = errors.mock.calls.filter((args) =>
      args.some((arg) => String(arg).includes('same key')),
    )
    expect(keyWarnings).toEqual([])
  } finally {
    errors.mockRestore()
  }
})
