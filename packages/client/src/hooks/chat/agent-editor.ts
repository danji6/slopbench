import { type ViewHandle, useView } from '@/hooks/view'
import { useCallback } from 'react'

/** `?view=` segment owned by the agent editor; its value is the active tab. */
export const AGENT_EDITOR_VIEW = 'agent'

export const AGENT_EDITOR_DEFAULT_TAB = 'profile'

export function useAgentEditorView(): ViewHandle {
  return useView(AGENT_EDITOR_VIEW)
}

export function useAgentEditorOpen(): boolean {
  return useAgentEditorView().active
}

export function useOpenAgentEditor(): () => void {
  const view = useAgentEditorView()
  return useCallback(() => view.open(AGENT_EDITOR_DEFAULT_TAB), [view])
}
