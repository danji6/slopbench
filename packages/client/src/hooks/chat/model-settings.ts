import type { ReasoningEffort, UIModel } from '@/lib/chat'
import { api } from '@sb/convex/_generated/api'
import {
  defaultModelReasoning,
  normalizeReasoningEffort as normalizeConfiguredEffort,
} from '@sb/core/model-reasoning'
import { useMutation } from 'convex/react'
import { useCallback, useMemo } from 'react'

import { useActiveAgent } from './agent'
import { useModels } from './models'
import { useActiveSession } from './session'
import { useSettings, useSettingsUpdate } from './settings'

export type ActiveModelSettingsState = {
  model: UIModel | null
  setModel: (model: UIModel | string) => void
  reasoningEffort: ReasoningEffort | undefined
  setReasoningEffort: (effort: ReasoningEffort) => void
  editable: boolean
}

export function normalizeReasoningEffort(
  effort: ReasoningEffort | undefined,
  configured?: UIModel['reasoning'],
): ReasoningEffort {
  return normalizeConfiguredEffort(
    effort,
    configured ?? defaultModelReasoning(),
  )
}

/** Session model controls, or recent defaults before a session exists. */
export function useActiveModelSettings(): ActiveModelSettingsState {
  const agent = useActiveAgent()
  const session = useActiveSession()
  const settings = useSettings()
  const updateSettings = useSettingsUpdate()
  const setSessionModel = useMutation(api.sessions.setModel)
  const setSessionReasoning = useMutation(api.sessions.setReasoningEffort)
  const { models, isLoading } = useModels()

  const editable = Boolean(agent && 'ownerId' in agent)
  const modelId = session ? session.model?.id : settings?.recentModel
  const reasoningEffort = (
    session ? session.reasoningEffort : settings?.recentReasoning
  ) as ReasoningEffort | undefined

  const model = useMemo(() => {
    if (isLoading || !modelId) return null
    if (session?.model?.id === modelId) return session.model
    return (
      models.find((candidate) => candidate.id === modelId) ?? { id: modelId }
    )
  }, [isLoading, modelId, models, session?.model])

  const setModel = useCallback(
    (value: UIModel | string) => {
      if (!editable) return
      const id = typeof value === 'string' ? value : value.id
      const selected = models.find((candidate) => candidate.id === id)
      const normalized = normalizeReasoningEffort(
        reasoningEffort,
        selected?.reasoning,
      )

      if (session) {
        void setSessionModel({
          sessionId: session._id,
          modelId: id,
          reasoningEffort: normalized,
        })
        return
      }

      void updateSettings({
        patch: { recentModel: id, recentReasoning: normalized },
      })
    },
    [
      editable,
      models,
      reasoningEffort,
      session,
      setSessionModel,
      updateSettings,
    ],
  )

  const setReasoningEffort = useCallback(
    (value: ReasoningEffort) => {
      if (!editable) return
      if (session) {
        void setSessionReasoning({
          sessionId: session._id,
          reasoningEffort: value,
        })
        return
      }
      void updateSettings({ patch: { recentReasoning: value } })
    },
    [editable, session, setSessionReasoning, updateSettings],
  )

  return {
    model,
    setModel,
    reasoningEffort,
    setReasoningEffort,
    editable,
  }
}
