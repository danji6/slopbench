import {
  getCreatedAgentId,
  getEditingAgentId,
  isNewAgent,
  setCreatedAgentId,
  setEditingAgentId,
  startNewAgent,
} from '@/lib/chat/agent-editor-store'
import {
  NEW_AGENT_DRAFT_KEY,
  agentSettingsDraftKey,
  clearEditorDraft,
  getEditorDraft,
  setEditorDraft,
} from '@/lib/chat/editor-draft-store'
import { APP_ID } from '@sb/core/const'
import { afterEach, expect, test } from 'bun:test'
import { setupDom } from '~/tests/setup/dom'

setupDom()

afterEach(() => {
  setEditingAgentId(null)
  clearEditorDraft(NEW_AGENT_DRAFT_KEY)
})

test('new agent selection and edits persist separately from database IDs', () => {
  setEditingAgentId('existing')
  startNewAgent()
  setEditorDraft(NEW_AGENT_DRAFT_KEY, { name: 'Writer', prompts: [] })

  expect(isNewAgent()).toBe(true)
  expect(getEditingAgentId()).toBeNull()
  expect(NEW_AGENT_DRAFT_KEY).not.toBe(agentSettingsDraftKey('existing'))
  expect(
    JSON.parse(localStorage.getItem(`${APP_ID}-agent-editor-selection`)!),
  ).toEqual({ newAgent: true })
  expect(
    JSON.parse(localStorage.getItem(`${APP_ID}-editor-drafts`)!)[
      NEW_AGENT_DRAFT_KEY
    ].value.name,
  ).toBe('Writer')
})

test('a partially completed Save retains its ID for retries', () => {
  startNewAgent()
  setCreatedAgentId('created')
  expect(isNewAgent()).toBe(true)
  expect(getCreatedAgentId()).toBe('created')
  expect(
    JSON.parse(localStorage.getItem(`${APP_ID}-agent-editor-selection`)!),
  ).toEqual({ newAgent: true, createdAgentId: 'created' })

  setEditingAgentId('created')
  expect(isNewAgent()).toBe(false)
  expect(getCreatedAgentId()).toBeUndefined()
  expect(getEditingAgentId()).toBe('created')
})

test('discarding a draft removes its values and leaves existing agents alone', () => {
  startNewAgent()
  setEditorDraft(NEW_AGENT_DRAFT_KEY, { name: 'Discard me' })
  clearEditorDraft(NEW_AGENT_DRAFT_KEY)
  setEditingAgentId('existing')
  expect(getEditorDraft(NEW_AGENT_DRAFT_KEY)).toBeUndefined()
  expect(getEditingAgentId()).toBe('existing')
})
