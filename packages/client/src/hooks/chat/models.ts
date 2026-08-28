import type { UIModel, UIModelConfig } from '@/lib/chat'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex/react'
import { useMemo } from 'react'

import { useActiveSession } from './session'
import { useSettings } from './settings'

export type ModelsConfig = {
  models: UIModel[]
  isLoading: boolean
}

export function useModels(): ModelsConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = useQuery((api as any).models.list) as UIModelConfig | undefined
  return {
    models: data?.models ?? [],
    isLoading: data === undefined,
  }
}

export function useActiveModel(): UIModel | null {
  const session = useActiveSession()
  const settings = useSettings()
  const { models, isLoading } = useModels()
  const modelId = session?.model?.id ?? settings?.recentModel

  return useMemo(() => {
    if (session?.model) return session.model
    if (isLoading || !modelId) return null
    return models.find((m) => m.id === modelId) ?? { id: modelId }
  }, [session, modelId, models, isLoading])
}
