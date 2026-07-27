export type HostFocus = {
  /** The element focus was last seen on, or `null` if focus left the host. */
  target: () => HTMLElement | null
  /** Puts the focus and caret back where they were before the last move. */
  restore: () => void
  stop: () => void
}

/** Starts remembering the focus and caret living inside `host`. */
export function trackHostFocus(host: HTMLElement): HostFocus {
  let focused: HTMLElement | null = null
  let range: Range | null = null

  function handleFocusIn(event: FocusEvent) {
    focused = event.target instanceof HTMLElement ? event.target : null
  }

  function handleFocusOut() {
    // Detaching the host blurs it without the user having gone anywhere
    if (host.isConnected) focused = null
  }

  function handleSelectionChange() {
    const selection = document.getSelection()
    if (!selection?.rangeCount) return
    const current = selection.getRangeAt(0)
    if (host.contains(current.commonAncestorContainer)) {
      range = current.cloneRange()
    }
  }

  host.addEventListener('focusin', handleFocusIn)
  host.addEventListener('focusout', handleFocusOut)
  document.addEventListener('selectionchange', handleSelectionChange)

  return {
    target: () => (focused?.isConnected ? focused : null),
    restore() {
      if (!focused?.isConnected) return
      focused.focus({ preventScroll: true })

      if (!range || !host.contains(range.commonAncestorContainer)) return
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    },
    stop() {
      host.removeEventListener('focusin', handleFocusIn)
      host.removeEventListener('focusout', handleFocusOut)
      document.removeEventListener('selectionchange', handleSelectionChange)
    },
  }
}

/** Moves `host` into `slot`, keeping every node inside it alive. */
export function moveHost(host: HTMLElement, slot: HTMLElement) {
  if (host.parentElement !== slot) slot.appendChild(host)
}

/**
 * First box inside `host`, distinguished by `display: contents` so that hosting
 * adds no box of its own, which also means they have no geometry and there is
 * nothing on them to measure.
 */
export function hostBox(host: HTMLElement): HTMLElement | null {
  let element: Element | null = host
  while (
    element instanceof HTMLElement &&
    getComputedStyle(element).display === 'contents'
  ) {
    element = element.firstElementChild
  }
  return element instanceof HTMLElement ? element : null
}
