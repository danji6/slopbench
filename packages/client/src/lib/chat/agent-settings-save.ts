import {
  type AgentFormValues,
  type AgentPromptSets,
  formValuesToCreate,
  formValuesToPatch,
  splitAgentForm,
} from '@/components/chat/entities/agent/agent-form'
import type { Id } from '@sb/convex/_generated/dataModel'

import { getCreatedAgentId, setCreatedAgentId } from './agent-editor-store'
import type { CreateAgentArgs, UpdateAgentArgs } from './types'

export type AgentSaveOptions = {
  agentId: Id<'agents'> | null
  newAgent: boolean
  pendingAvatar: File | null
  avatarCleared: boolean
}

export type AgentSaveActions = {
  create: (args: CreateAgentArgs) => Promise<Id<'agents'>>
  update: (args: UpdateAgentArgs) => Promise<unknown>
  savePromptSets: (id: Id<'agents'>, sets: AgentPromptSets) => Promise<void>
  clearAvatar: (args: { agentId: Id<'agents'> }) => Promise<unknown>
  uploadAvatar: (id: Id<'agents'>, file: File) => Promise<unknown>
}

/** Saves staged settings and reuses a created ID when an avatar upload is retried. */
export async function persistAgentSettings(
  values: AgentFormValues,
  options: AgentSaveOptions,
  actions: AgentSaveActions,
): Promise<Id<'agents'>> {
  let id = options.newAgent
    ? (getCreatedAgentId() as Id<'agents'> | undefined)
    : options.agentId

  if (!options.newAgent && !id) throw new Error('Select an agent to save.')

  if (!id) {
    id = await actions.create(await formValuesToCreate(values))
    setCreatedAgentId(id)
  } else {
    const { doc, sets } = splitAgentForm(values)
    await actions.update(await formValuesToPatch(id, doc))
    await actions.savePromptSets(id, sets)
  }

  if (options.pendingAvatar) {
    await actions.uploadAvatar(id, options.pendingAvatar)
  } else if (options.avatarCleared) {
    await actions.clearAvatar({ agentId: id })
  }
  return id
}
