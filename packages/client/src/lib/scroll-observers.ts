import type { ScrollTarget } from './scroll-target'

/** Watches content changes without duplicating resize and mutation policy. */
export function observeScrollContent(
  target: ScrollTarget,
  content: HTMLElement,
  sentinel: HTMLElement,
  changed: () => void,
) {
  const mutations = new MutationObserver(changed)
  mutations.observe(content, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  let height = target.getScrollHeight()
  const resize = new ResizeObserver(() => {
    const next = target.getScrollHeight()
    if (next === height) return
    height = next
    changed()
  })
  resize.observe(content)
  for (const child of Array.from(content.children))
    if (child !== sentinel) resize.observe(child)

  return () => {
    mutations.disconnect()
    resize.disconnect()
  }
}

export type ScrollMovement = {
  scrollingUp: boolean
  scrollingDown: boolean
  heightShrank: boolean
  viewportChanged: boolean
}

/** Measures movement separately from layout and viewport changes. */
export function observeScrollMovement(
  target: ScrollTarget,
  moved: (movement: ScrollMovement) => void,
) {
  let top = target.getScrollTop(),
    height = target.getScrollHeight(),
    viewport = target.getClientHeight()

  const listener = () => {
    const nextTop = target.getScrollTop(),
      nextHeight = target.getScrollHeight(),
      nextViewport = target.getClientHeight()
    const heightShrank = nextHeight < height
    const movement = {
      heightShrank,
      viewportChanged: nextViewport !== viewport,
      scrollingUp: !heightShrank && nextTop < top,
      scrollingDown: nextTop > top,
    }
    top = nextTop
    height = nextHeight
    viewport = nextViewport
    moved(movement)
  }

  target.addEventListener('scroll', listener, { passive: true })
  return () => target.removeEventListener('scroll', listener)
}

/** Owns pointer/touch/wheel listeners and reports deliberate user interaction. */
export function observeScrollInput(
  target: ScrollTarget,
  callbacks: { start(): void; end(): void; direction(direction: 1 | -1): void },
) {
  const isTouch = (event: Event) =>
    (event as PointerEvent).pointerType === 'touch'
  const start = (event: Event) => {
    if (!isTouch(event)) callbacks.start()
  }
  const end = (event: Event) => {
    if (!isTouch(event)) callbacks.end()
  }
  const wheel = (event: Event) => {
    const delta = (event as WheelEvent).deltaY
    if (delta) callbacks.direction(delta > 0 ? 1 : -1)
  }
  let touchY = 0
  const touchStart = (event: Event) => {
    touchY = (event as TouchEvent).touches[0]?.clientY ?? 0
  }
  const touchMove = (event: Event) => {
    const next = (event as TouchEvent).touches[0]?.clientY ?? 0
    if (next !== touchY) callbacks.direction(next < touchY ? 1 : -1)
    touchY = next
  }
  target.addEventListener('pointerdown', start, {
    passive: true,
    capture: true,
  })

  window.addEventListener('pointerup', end, { capture: true })
  window.addEventListener('pointercancel', end, { capture: true })
  target.addEventListener('wheel', wheel, { passive: true })
  target.addEventListener('touchstart', touchStart, { passive: true })
  target.addEventListener('touchmove', touchMove, { passive: true })
  return () => {
    target.removeEventListener('pointerdown', start, { capture: true })
    window.removeEventListener('pointerup', end, { capture: true })
    window.removeEventListener('pointercancel', end, { capture: true })
    target.removeEventListener('wheel', wheel)
    target.removeEventListener('touchstart', touchStart)
    target.removeEventListener('touchmove', touchMove)
  }
}
