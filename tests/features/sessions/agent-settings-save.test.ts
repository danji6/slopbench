import { newAgentFormValues } from '@/components/chat/entities/agent/agent-form'
import {
  getCreatedAgentId,
  setEditingAgentId,
  startNewAgent,
} from '@/lib/chat/agent-editor-store'
import {
  type AgentSaveActions,
  type AgentSaveOptions,
  persistAgentSettings,
} from '@/lib/chat/agent-settings-save'
import type { Id } from '@sb/convex/_generated/dataModel'
import { afterEach, expect, mock, test } from 'bun:test'

const ID = 'created' as Id<'agents'>
const options: AgentSaveOptions = {
  agentId: null,
  newAgent: true,
  pendingAvatar: null,
  avatarCleared: false,
}

function actions(): AgentSaveActions {
  return {
    create: mock(async () => ID),
    update: mock(async () => {}),
    savePromptSets: mock(async () => {}),
    uploadAvatar: mock(async () => {}),
    clearAvatar: mock(async () => {}),
  }
}

afterEach(() => setEditingAgentId(null))

test('New stays local and Save submits all settings in one create', async () => {
  const backend = actions()
  const values = newAgentFormValues()
  startNewAgent()
  expect(backend.create).not.toHaveBeenCalled()

  expect(await persistAgentSettings(values, options, backend)).toBe(ID)
  expect(backend.create).toHaveBeenCalledTimes(1)
  expect(backend.create).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'New agent', prompts: values.prompts }),
  )
  expect(backend.update).not.toHaveBeenCalled()
  expect(backend.savePromptSets).not.toHaveBeenCalled()
})

test('a rejected create remains retryable without marking an agent as created', async () => {
  const backend = actions()
  backend.create = mock(async () => {
    throw new Error('Rejected')
  })
  startNewAgent()
  await expect(
    persistAgentSettings(newAgentFormValues(), options, backend),
  ).rejects.toThrow('Rejected')
  expect(getCreatedAgentId()).toBeUndefined()
  backend.create = mock(async () => ID)
  expect(
    await persistAgentSettings(newAgentFormValues(), options, backend),
  ).toBe(ID)
})

test('retry after avatar failure updates the created agent instead of duplicating it', async () => {
  const backend = actions()
  backend.uploadAvatar = mock(async () => {
    throw new Error('Upload failed')
  })
  const avatar = new File(['avatar'], 'avatar.png')
  const withAvatar = { ...options, pendingAvatar: avatar }
  startNewAgent()

  await expect(
    persistAgentSettings(newAgentFormValues(), withAvatar, backend),
  ).rejects.toThrow('Upload failed')
  expect(getCreatedAgentId()).toBe(ID)
  backend.uploadAvatar = mock(async () => {})
  const edited = { ...newAgentFormValues(), name: 'Edited after failure' }
  expect(await persistAgentSettings(edited, withAvatar, backend)).toBe(ID)
  expect(backend.create).toHaveBeenCalledTimes(1)
  expect(backend.update).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: ID, name: edited.name }),
  )
  expect(backend.savePromptSets).toHaveBeenCalledWith(
    ID,
    expect.objectContaining({ prompts: edited.prompts }),
  )
  expect(backend.uploadAvatar).toHaveBeenCalledWith(ID, avatar)
})

test('saving an existing agent preserves the update path', async () => {
  const backend = actions()
  await persistAgentSettings(
    newAgentFormValues(),
    { ...options, newAgent: false, agentId: ID },
    backend,
  )
  expect(backend.create).not.toHaveBeenCalled()
  expect(backend.update).toHaveBeenCalledTimes(1)
  expect(backend.savePromptSets).toHaveBeenCalledTimes(1)
})
