import { useEffect } from 'react'

/**
 * Registry for the element focus falls back to, used for the chat composer.
 * Modal layers hand focus back here when they close, and so does the window
 * when it regains focus.
 */

type FocusTargetGetter = () => HTMLElement | null

/** Ancestor marker rendering a target unfocusable. */
const INERT = '[inert]'
/** Markers set on content covered by an open floating layer. */
const COVERED = `${INERT}, [data-base-ui-inert], [aria-hidden="true"]`

const targets: FocusTargetGetter[] = []
let openLayers = 0

/** Registers a focus fallback target. Returns its unregister function. */
export function registerFocusReturn(get: FocusTargetGetter): () => void {
  targets.push(get)
  if (targets.length === 1) window.addEventListener('focus', handleWindowFocus)

  return () => {
    const index = targets.lastIndexOf(get)
    if (index >= 0) targets.splice(index, 1)
    if (!targets.length) window.removeEventListener('focus', handleWindowFocus)
  }
}

/**
 * Counts one modal layer while it is open. Render it inside the layer's portal
 * so it mounts with the layer and never while it is closed.
 */
export function FocusLayer(): null {
  useEffect(() => {
    openLayers++
    return () => {
      openLayers--
    }
  }, [])
  return null
}

/**
 * Return target for a closing modal layer, or `null` to leave the layer's own
 * behavior in place, which is the case when another layer stays open behind it,
 * since focus then belongs inside that one.
 *
 * The closing layer still counts itself here: it resolves this during a layout
 * effect cleanup, which runs before {@link FocusLayer} releases its count.
 */
export function getFocusReturnTarget(): HTMLElement | null {
  return openLayers > 1 ? null : findTarget(INERT)
}

function isEditable(node: Element | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  return (
    node.tagName === 'INPUT' ||
    node.tagName === 'TEXTAREA' ||
    node.isContentEditable
  )
}

function handleWindowFocus() {
  // Refocusing would pop the on-screen keyboard on every tab switch
  if (window.matchMedia('(pointer: coarse)').matches) return
  // Something the user picked already holds focus
  if (isEditable(document.activeElement)) return
  // Focusing an editor would collapse a selection made before leaving
  if (window.getSelection()?.isCollapsed === false) return

  findTarget(COVERED)?.focus({ preventScroll: true })
}

function findTarget(blockedBy: string): HTMLElement | null {
  for (let i = targets.length - 1; i >= 0; i--) {
    const el = targets[i]!()
    if (el?.isConnected && !el.closest(blockedBy)) return el
  }
  return null
}
