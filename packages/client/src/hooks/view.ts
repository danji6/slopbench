import type { SegmentOptions, ViewSegment } from '@/lib/view'
import {
  findViewSegment,
  parseViewPath,
  viewSearch,
  withViewSegment,
  withoutViewSegment,
} from '@/lib/view'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearch } from 'wouter'

export type ViewHandle = {
  /** Whether this view's segment is present in the current path. */
  active: boolean
  value?: string
  /** Opens the view and pushes history. */
  open: (value?: string) => void
  /** Changes the value in place without a history entry. */
  setValue: (value: string | undefined, options?: SegmentOptions) => void
  /** Closes this view and anything nested below it. */
  close: () => void
}

export function useViewPath(): ViewSegment[] {
  const search = useSearch()
  return useMemo(() => parseViewPath(search), [search])
}

/** Navigates to a view path, preserving the pathname and other parameters. */
function useViewNavigate() {
  const [location, navigate] = useLocation()
  const search = useSearch()

  return useCallback(
    (path: readonly ViewSegment[], replace: boolean) => {
      const next = viewSearch(search, path)
      navigate(next ? `${location}?${next}` : location, { replace })
    },
    [location, navigate, search],
  )
}

export function useView(name: string): ViewHandle {
  const path = useViewPath()
  const go = useViewNavigate()
  const segment = findViewSegment(path, name)

  return useMemo<ViewHandle>(
    () => ({
      active: segment !== undefined,
      value: segment?.value,
      open: (value) => go(withViewSegment(path, { name, value }), false),
      setValue: (value, options) =>
        go(withViewSegment(path, { name, value }, options), true),
      close: () => go(withoutViewSegment(path, name), false),
    }),
    [go, name, path, segment],
  )
}

export type ViewCloseGuard = {
  /** An external navigation tried to close the view while it was dirty. */
  pending: boolean
  /** Discards the changes and lets the close through. */
  confirm: () => void
  /** Keeps editing; the URL was already restored. */
  cancel: () => void
}

/** Prevents going back in history from discarding unsaved work. */
export function useViewCloseGuard(
  name: string,
  { isDirty, onDiscard }: { isDirty: boolean; onDiscard: () => void },
): ViewCloseGuard {
  const path = useViewPath()
  const go = useViewNavigate()
  const active = findViewSegment(path, name) !== undefined

  const [pending, setPending] = useState(false)

  // Snapshot for the popstate listener, which runs before the next render
  const latest = useRef({ active, isDirty, restorePath: path })
  useEffect(() => {
    latest.current = {
      active,
      isDirty,
      restorePath: active ? path : latest.current.restorePath,
    }
  })

  useEffect(() => {
    function handlePopState() {
      const {
        active: wasActive,
        isDirty: wasDirty,
        restorePath,
      } = latest.current
      if (!wasActive || !wasDirty) return
      if (findViewSegment(parseViewPath(window.location.search), name)) return

      go(restorePath, true)
      setPending(true)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [go, name])

  const confirm = useCallback(() => {
    setPending(false)
    onDiscard()
    go(withoutViewSegment(latest.current.restorePath, name), false)
  }, [go, name, onDiscard])

  const cancel = useCallback(() => setPending(false), [])

  return { pending, confirm, cancel }
}
