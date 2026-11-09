import type { ApprovalAction } from '@/lib/chat/tool-approval-policy'
import type { KeyboardEvent, RefObject } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

type ApprovalInteractionOptions = {
  actions: ApprovalAction[]
  selectAction: (action: ApprovalAction) => void
  focusOnOpen: boolean
  restoreFocusRef?: RefObject<{ focus(options?: FocusOptions): void } | null>
}

export function useApprovalInteraction({
  actions,
  selectAction,
  focusOnOpen,
  restoreFocusRef,
}: ApprovalInteractionOptions) {
  const rootRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const [selection, setSelectedAction] = useState('')
  const selected = actions.find((action) => action.id === selection) ?? actions[0] // prettier-ignore

  const restoreFocus = useCallback(() => {
    if (document.activeElement === document.body) {
      restoreFocusRef?.current?.focus({ preventScroll: true })
    }
  }, [restoreFocusRef])

  useLayoutEffect(() => {
    if (!focusOnOpen) return

    const frame = requestAnimationFrame(() =>
      actionsRef.current?.focus({ preventScroll: true }),
    )
    return () => cancelAnimationFrame(frame)
  }, [focusOnOpen])

  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(document.activeElement)) {
        requestAnimationFrame(restoreFocus)
      }
    }
  }, [restoreFocus])

  function handleActionKey(event: KeyboardEvent<HTMLDivElement>) {
    if (isComposing(event) || (event.key === 'Escape' && event.repeat)) {
      event.stopPropagation()
      return
    }

    const action = findKeyboardAction(event, actions, selected)
    if (!action) return

    event.preventDefault()
    event.stopPropagation()
    if (!event.repeat) selectAction(action)
  }

  function handleNoteKey(event: KeyboardEvent<HTMLDivElement>) {
    if (isComposing(event)) {
      if (event.key === 'Escape') event.stopPropagation()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      actionsRef.current?.focus({ preventScroll: true })
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.stopPropagation()
      if (selected && !event.repeat) selectAction(selected)
    }
  }

  return {
    rootRef,
    actionsRef,
    selectedAction: selected?.id ?? '',
    setSelectedAction,
    handleActionKey,
    handleNoteKey,
  }
}

function isComposing(event: KeyboardEvent) {
  return event.nativeEvent.isComposing || event.keyCode === 229
}

function findKeyboardAction(
  event: KeyboardEvent,
  actions: ApprovalAction[],
  selected: ApprovalAction | undefined,
) {
  if (event.key === 'Enter') return selected
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const key = event.key.toLowerCase()
  return actions.find((action) => action.shortcut === key)
}
