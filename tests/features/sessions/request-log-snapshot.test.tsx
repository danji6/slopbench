import { useRequestLogSnapshot } from '@/hooks/chat/request-log'
import type { CacheDiagnostic } from '@cv/convex/types'
import { afterEach, expect, test } from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { setupDom } from '~/tests/setup/dom'

setupDom()
const previousActEnvironment = (globalThis as Record<string, unknown>)
  .IS_REACT_ACT_ENVIRONMENT
let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
    previousActEnvironment
})

test('keeps diagnostics and the request URL in the same snapshot until reopened', () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  root = createRoot(container)
  const first = {
    logUrl: 'first',
    cacheDiagnostics: [{ id: 'first' }] as CacheDiagnostic[],
  }
  const next = {
    logUrl: 'next',
    cacheDiagnostics: [{ id: 'next' }] as CacheDiagnostic[],
  }
  function Probe({
    value,
    open,
  }: {
    value: typeof first | undefined
    open: boolean
  }) {
    const snapshot = useRequestLogSnapshot(value, open)
    return (
      <output>
        {snapshot
          ? `${snapshot.logUrl}:${snapshot.cacheDiagnostics[0]?.id}`
          : 'waiting'}
      </output>
    )
  }
  act(() => root?.render(<Probe value={undefined} open />))
  expect(container.textContent).toBe('waiting')
  act(() => root?.render(<Probe value={first} open />))
  expect(container.textContent).toBe('first:first')
  act(() => root?.render(<Probe value={next} open />))
  expect(container.textContent).toBe('first:first')
  act(() => root?.render(<Probe value={next} open={false} />))
  act(() => root?.render(<Probe value={next} open />))
  expect(container.textContent).toBe('next:next')
})
