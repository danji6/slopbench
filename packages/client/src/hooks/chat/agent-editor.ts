import { type ViewHandle, useView } from '@/hooks/view'
import {
  getEditingAgentId,
  setEditingAgentId,
} from '@/lib/chat/agent-editor-store'
import { useCallback } from 'react'

import { useActiveAgent, useOwnedAgents } from './agent'

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
  const owned = useOwnedAgents()
  const activeAgent = useActiveAgent()

  return useCallback(() => {
    const current = getEditingAgentId()
    const editable = owned?.some((agent) => agent._id === current)
    const fallback = owned?.find((agent) => agent._id === activeAgent?._id)
    if (!editable && fallback) setEditingAgentId(fallback._id)

    view.open(AGENT_EDITOR_DEFAULT_TAB)
  }, [view, owned, activeAgent])
}
