import { useMessageList } from '@/components/chat/messages/message-list/message-list-context'
import type { TerminalHandle } from '@/components/ui/terminal'
import { getNavPaddingPx } from '@/hooks/nav-padding'
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'

import type { ComposerHandle } from './composer-editor'
import { useMessageStore } from './messages'

const handledJobs = new WeakMap<
  ReturnType<typeof useMessageStore>,
  Set<string>
>()

/** Offers focus once when a waiting terminal is ready and on screen. */
export function useShellFocus(
  jobId: string,
  waiting: boolean,
  wrapperRef: RefObject<HTMLDivElement | null>,
  handleRef: RefObject<TerminalHandle | null>,
) {
  const store = useMessageStore()
  const {
    topPadding = 0,
    bottomPadding = 0,
    shellFocusBlocked,
  } = useMessageList() ?? {}

  useEffect(() => {
    const wrapper = wrapperRef.current
    const focus = handleRef.current?.focus
    if (!waiting || !wrapper || !focus) return
    const handled = handledJobs.get(store) ?? new Set<string>()
    if (handled.has(jobId)) return
    handledJobs.set(store, handled)

    let disposed = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (disposed || !entry?.intersectionRect.height) return
        if (wrapper.closest('[inert]')) return
        observer.disconnect()
        if (handled.has(jobId)) return
        handled.add(jobId)
        if (!shellFocusBlocked && canHandOffFocus(wrapper)) focus()
      },
      {
        rootMargin: `-${getNavPaddingPx(topPadding)}px 0px -${bottomPadding}px`,
        threshold: [0, 0.01],
      },
    )
    observer.observe(wrapper)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [
    jobId,
    waiting,
    wrapperRef,
    handleRef,
    store,
    topPadding,
    bottomPadding,
    shellFocusBlocked,
  ])
}

function canHandOffFocus(wrapper: HTMLElement) {
  if (!document.hasFocus()) return false
  const active = document.activeElement
  return (
    active === document.body ||
    wrapper.contains(active) ||
    (active instanceof HTMLElement &&
      active.isContentEditable &&
      Boolean(active.closest('[data-slot="chat-box"]')))
  )
}

type RestoreShellFocusOptions = {
  composerRef: RefObject<ComposerHandle | null>
  available: boolean
  dockVisible: boolean
  revealComposer: () => void
}

/** Restores focus after a terminal that owned focus has exited. */
export function useRestoreShellFocus({
  composerRef,
  available,
  dockVisible,
  revealComposer,
}: RestoreShellFocusOptions) {
  const pendingInput = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const input = pendingInput.current
    if (!input || !dockVisible) return
    pendingInput.current = null
    if (available && canRestoreFocus(input)) {
      composerRef.current?.focus({ preventScroll: true })
    }
  }, [available, composerRef, dockVisible])

  return useCallback(
    (input: HTMLElement) => {
      if (!available || !canRestoreFocus(input)) return
      if (dockVisible) {
        composerRef.current?.focus({ preventScroll: true })
        return
      }

      pendingInput.current = input
      revealComposer()
    },
    [available, composerRef, dockVisible, revealComposer],
  )
}

function canRestoreFocus(input: HTMLElement) {
  const active = document.activeElement
  // Removing the focused terminal can leave focus on the document body.
  return document.hasFocus() && (active === input || active === document.body)
}
