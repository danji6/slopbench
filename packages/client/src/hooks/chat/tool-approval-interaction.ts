import { type ApprovalAction } from '@/lib/chat/tool-approval-policy'
import { useEffect, useState } from 'react'

export function useSelectedApprovalAction(
  actions: ApprovalAction[],
  setSelectedAction: (value: string) => void,
) {
  const actionSignature = actions.map((action) => action.id).join('|')
  const [prevActionSignature, setPrevActionSignature] =
    useState(actionSignature)

  if (prevActionSignature !== actionSignature) {
    setPrevActionSignature(actionSignature)
    setSelectedAction(actions[0]?.id ?? '')
  }
}

export function useApprovalKeybinds({
  actions,
  onSelect,
  selectedAction,
  setSelectedAction,
  visible,
  rootRef,
  focusNote,
}: {
  actions: ApprovalAction[]
  onSelect: (action: ApprovalAction) => void
  selectedAction: string
  setSelectedAction: (value: string) => void
  visible: boolean
  rootRef: React.RefObject<HTMLDivElement | null>
  focusNote: () => void
}) {
  useEffect(() => {
    if (!visible || actions.length === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      const root = rootRef.current
      if (!root || !root.contains(document.activeElement)) return

      // While typing a note, let the editor own its keys. Ctrl/Cmd+Enter still
      // submits the highlighted action; Escape hands focus back to the list.
      const typingNote =
        (document.activeElement as HTMLElement | null)?.isContentEditable ===
        true
      if (typingNote) {
        // Tab/Escape leave the note and hand focus to the options list
        if (e.key === 'Tab' || e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          root.focus({ preventScroll: true })
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          e.stopPropagation()
          const action =
            actions.find((item) => item.id === selectedAction) ?? actions[0]
          if (action) onSelect(action)
        }
        return
      }

      // From the options, Tab/Shift+Tab moves into the note editor
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        focusNote()
        return
      }

      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        const key = e.key.toLowerCase()
        const action = actions.find((item) => item.shortcut === key)
        if (action) {
          e.preventDefault()
          onSelect(action)
          return
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const idx = actions.findIndex((action) => action.id === selectedAction)
        setSelectedAction(actions[(idx + 1) % actions.length]!.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = actions.findIndex((action) => action.id === selectedAction)
        setSelectedAction(
          actions[(idx - 1 + actions.length) % actions.length]!.id,
        )
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const action = actions.find((item) => item.id === selectedAction)
        if (action) onSelect(action)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [
    actions,
    onSelect,
    rootRef,
    selectedAction,
    setSelectedAction,
    visible,
    focusNote,
  ])
}
