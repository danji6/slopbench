import { useMemo } from 'react'

import { useView } from './view'

/**
 * `?view=` segment carrying the id of the editor currently expanded to fill the
 * window.
 */
export const FULLSCREEN_VIEW = 'full'

export type FullscreenHandle = {
  active: boolean
  enter: () => void
  exit: () => void
  toggle: () => void
}

/** Expanded state for the editor known as `id`. */
export function useFullscreenView(id: string): FullscreenHandle {
  const view = useView(FULLSCREEN_VIEW)
  const active = view.value === id

  const { open, close } = view
  return useMemo(
    () => ({
      active,
      enter: () => open(id),
      exit: () => close(),
      toggle: () => (active ? close() : open(id)),
    }),
    [active, close, id, open],
  )
}
