import type { ReasoningEffort, UIModel } from '@/lib/chat'
import type { Doc } from '@sb/convex/_generated/dataModel'
import { useCallback, useMemo } from 'react'

import { useActiveAgent, useAgentUpdate, useEditingAgent } from './agent'
import type { ActiveAgent } from './agent'
import { useModels } from './models'

export type ModelSettingsState = {
  model: UIModel | null
  setModel: (model: UIModel | string) => void
  reasoningEffort: ReasoningEffort | undefined
  setReasoningEffort: (effort: ReasoningEffort) => void
  initialModel: string | undefined
}

export type ActiveModelSettingsState = ModelSettingsState & {
  editable: boolean
}

function useModelSettingsFor(agent: Doc<'agents'> | null): ModelSettingsState {
  const { models, isLoading } = useModels()
  const updateAgent = useAgentUpdate()

  const modelId = agent?.modelId ?? null
  const reasoningEffort = (agent?.reasoningEffort ?? undefined) as
    | ReasoningEffort
    | undefined

  const model = useMemo(() => {
    if (isLoading) return null
    if (!modelId) return null
    return models.find((m) => m.id === modelId) ?? { id: modelId }
  }, [modelId, models, isLoading])

  const setModel = useCallback(
    (value: UIModel | string) => {
      if (!agent) return
      const id = typeof value === 'string' ? value : value.id
      void updateAgent({ agentId: agent._id, modelId: id })
    },
    [agent, updateAgent],
  )

  const setReasoningEffort = useCallback(
    (value: ReasoningEffort) => {
      if (!agent) return
      void updateAgent({ agentId: agent._id, reasoningEffort: value })
    },
    [agent, updateAgent],
  )

  return {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    initialModel: undefined,
  }
}

export function useModelSettings(): ModelSettingsState {
  return useModelSettingsFor(useEditingAgent())
}

/** Only owned agents are full documents that can be edited in place. */
function ownedAgent(agent: ActiveAgent | null): Doc<'agents'> | null {
  return agent && 'prompts' in agent ? agent : null
}

export function useActiveModelSettings(): ActiveModelSettingsState {
  const agent = ownedAgent(useActiveAgent())
  return { ...useModelSettingsFor(agent), editable: agent !== null }
}
