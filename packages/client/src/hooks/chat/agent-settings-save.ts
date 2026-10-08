import type { AgentFormValues } from '@/components/chat/entities/agent/agent-form'
import {
  type AgentSaveOptions,
  persistAgentSettings,
} from '@/lib/chat/agent-settings-save'
import { type AvatarUploadResult, avatarUploadForm } from '@/lib/chat/avatar'
import { api } from '@sb/convex/_generated/api'
import { useMutation } from 'convex/react'

import { useHttpAction } from '../http'
import { useAgentUpdate } from './agent'
import { useAgentPromptSetsSave } from './prompts'

/** Creates all settings atomically, retaining the ID if an avatar upload fails. */
export function useAgentSettingsPersistence(options: AgentSaveOptions) {
  const create = useMutation(api.agents.create)
  const update = useAgentUpdate()
  const savePromptSets = useAgentPromptSetsSave()
  const clearAvatar = useMutation(api.agents.clearAvatar)
  const uploadAvatar = useHttpAction<FormData, AvatarUploadResult>('/io/avatar/upload') // prettier-ignore

  return (values: AgentFormValues) =>
    persistAgentSettings(values, options, {
      create,
      update,
      savePromptSets,
      clearAvatar,
      uploadAvatar: async (id, file) =>
        uploadAvatar.call(await avatarUploadForm(id, file)),
    })
}
