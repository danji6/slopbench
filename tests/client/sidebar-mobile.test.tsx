/// <reference types="bun-types" />
import type * as SidebarTypes from '@/components/ui/sidebar'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'

import { setupDom } from '../setup/dom'

setupDom()

/**
 * Regression: a sidebar pinned on desktop kept its pinned state on mobile,
 * where `close()` refuses to run while pinned. The mobile drawer therefore
 * could never be dismissed - not by the drawer itself and not by session
 * navigation, which calls `close()` on select. Pinning must be ignored while
 * the sidebar renders as a drawer (`lg` breakpoint and below).
 *
 * The component tree imports modules whose server checks run at import time,
 * and the DOM only exists after `GlobalRegistrator.register()`, so the module
 * under test has to be imported dynamically inside `beforeAll`.
 */
type SidebarCtx = ReturnType<typeof SidebarTypes.useSidebar>

let sidebar: typeof SidebarTypes

beforeAll(async () => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  // Dynamic because the component tree reads `window` at module eval time;
  // the DOM only exists once setupDom's beforeAll has registered it.
  sidebar = await import('@/components/ui/sidebar')
})

const MOBILE_WIDTH = 375
const DESKTOP_WIDTH = 1024

/**
 * happy-dom stops delivering `change` events on MediaQueryList instances that
 * were created after a `setViewport` call, so breakpoint updates go silent.
 * Wrap `matchMedia` with a stable-per-query shim whose `matches` stays live
 * and whose listeners are notified explicitly by `setViewport`.
 */
type ChangeListener = (event: { matches: boolean }) => void

type MediaShim = {
  readonly matches: boolean
  addEventListener: (type: string, listener: ChangeListener) => void
  removeEventListener: (type: string, listener: ChangeListener) => void
}

let notifyBreakpoints: () => void = () => {}

beforeEach(() => {
  const original = window.matchMedia.bind(window)
  const shims = new Map<
    string,
    MediaShim & { listeners: Set<ChangeListener> }
  >()

  window.matchMedia = ((query: string) => {
    const existing = shims.get(query)
    if (existing) return existing

    const listeners = new Set<ChangeListener>()
    const shim: MediaShim & { listeners: Set<ChangeListener> } = {
      get matches() {
        return original(query).matches
      },
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
      listeners,
    }
    shims.set(query, shim)
    return shim
  }) as unknown as typeof window.matchMedia

  notifyBreakpoints = () => {
    for (const shim of shims.values()) {
      const event = { matches: shim.matches }
      for (const listener of [...shim.listeners]) listener(event)
    }
  }
})

function Probe({ onCtx }: { onCtx: (ctx: SidebarCtx) => void }) {
  const ctx = sidebar.useSidebar()
  onCtx(ctx)
  return (
    <div data-testid="probe">
      {JSON.stringify({ isOpen: ctx.isOpen, pinned: ctx.pinned })}
    </div>
  )
}

type MountOptions = {
  defaultPinned?: boolean
  defaultCollapsed?: boolean
}

function mountSidebar(options: MountOptions = {}): {
  getCtx: () => SidebarCtx
  readState: () => { isOpen: boolean; pinned: boolean }
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  let captured: SidebarCtx | null = null
  const readState = () =>
    JSON.parse(
      container.querySelector('[data-testid="probe"]')?.textContent ?? '{}',
    ) as { isOpen: boolean; pinned: boolean }

  const props = {
    side: 'left' as const,
    defaultPinned: options.defaultPinned ?? false,
    defaultCollapsed: options.defaultCollapsed ?? true,
  }

  act(() => {
    root.render(
      <sidebar.Sidebar {...props}>
        <Probe onCtx={(ctx) => (captured = ctx)} />
      </sidebar.Sidebar>,
    )
  })

  activeRoot = root
  return { getCtx: () => captured as SidebarCtx, readState }
}

let activeRoot: Root | null = null

function setViewport(width: number) {
  const happyDOM = (
    window as unknown as {
      happyDOM?: { setViewport: (options: { width: number }) => void }
    }
  ).happyDOM
  happyDOM?.setViewport({ width })
  notifyBreakpoints()
}

describe('mobile sidebar pinning', () => {
  afterEach(() => {
    const root = activeRoot
    if (root) act(() => root.unmount())
    activeRoot = null
    document.body.innerHTML = ''
  })

  test('a pinned sidebar can be closed on mobile', () => {
    setViewport(MOBILE_WIDTH)
    const m = mountSidebar({
      defaultPinned: true,
      defaultCollapsed: false,
    })

    // Pinning is inert on mobile, even though the persisted state says pinned.
    expect(m.readState()).toEqual({ isOpen: true, pinned: false })

    act(() => {
      m.getCtx().close()
    })
    expect(m.readState().isOpen).toBe(false)
  })

  test('a pinned sidebar stays open on desktop until manually closed', () => {
    setViewport(DESKTOP_WIDTH)
    const m = mountSidebar({
      defaultPinned: true,
      defaultCollapsed: false,
    })
    expect(m.readState()).toEqual({ isOpen: true, pinned: true })

    act(() => {
      m.getCtx().close()
    })
    expect(m.readState().isOpen).toBe(true)

    act(() => {
      m.getCtx().toggle()
    })
    expect(m.readState().isOpen).toBe(false)
  })

  test('an unpinned sidebar closes normally on desktop', () => {
    setViewport(DESKTOP_WIDTH)
    const m = mountSidebar({ defaultCollapsed: false })
    expect(m.readState()).toEqual({ isOpen: true, pinned: false })

    act(() => {
      m.getCtx().close()
    })
    expect(m.readState().isOpen).toBe(false)
  })

  test('shrinking a pinned desktop sidebar to mobile releases the pin', () => {
    setViewport(DESKTOP_WIDTH)
    const m = mountSidebar({
      defaultPinned: true,
      defaultCollapsed: false,
    })
    expect(m.readState().pinned).toBe(true)

    act(() => {
      setViewport(MOBILE_WIDTH)
    })
    expect(m.readState()).toEqual({ isOpen: true, pinned: false })

    act(() => {
      m.getCtx().close()
    })
    expect(m.readState().isOpen).toBe(false)
  })

  test('growing back to desktop restores the persisted pin', () => {
    setViewport(MOBILE_WIDTH)
    const m = mountSidebar({
      defaultPinned: true,
      defaultCollapsed: false,
    })
    expect(m.readState().pinned).toBe(false)

    act(() => {
      setViewport(DESKTOP_WIDTH)
    })
    expect(m.readState().pinned).toBe(true)
  })
})
