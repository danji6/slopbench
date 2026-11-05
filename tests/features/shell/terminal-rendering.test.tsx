/// <reference types="bun-types" />
import { TerminalText } from '@/components/ui/terminal-text'
import type { TerminalHandle } from '@/components/ui/terminal-view'
import { useTerminalFeed } from '@/hooks/terminal-feed'
import { afterEach, expect, test } from 'bun:test'
import { StrictMode, act, useRef } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupReactDom } from '~/tests/setup/dom'

setupReactDom()

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

function TerminalHarness({ term }: { term: string }) {
  const handle = useRef<TerminalHandle>(null)
  const resetFeed = useTerminalFeed(handle, term, 0)

  return <TerminalText ref={handle} onReady={resetFeed} />
}

test.each(['', '$ eslint\r\n'])(
  'renders output once through StrictMode replay, updates, and remounts (initial=%j)',
  async (initial) => {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    const render = async (term: string, key = 'original') => {
      await act(async () => {
        root?.render(
          <StrictMode>
            <TerminalHarness key={key} term={term} />
          </StrictMode>,
        )
      })
    }
    const lines = () =>
      [...container.querySelectorAll('pre > div')].map(
        (line) => line.textContent,
      )

    await render(initial)
    expect(lines()).toEqual(initial ? ['$ eslint', ''] : [''])

    const updated = `${initial}done\r\n`
    const expected = initial ? ['$ eslint', 'done', ''] : ['done', '']
    await render(updated)
    expect(lines()).toEqual(expected)

    await render(updated, 'remounted')
    expect(lines()).toEqual(expected)
  },
)
