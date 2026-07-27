/// <reference types="bun-types" />
import {
  SCRIPTS_DRAFT_KEY,
  USER_SETTINGS_DRAFT_KEY,
  agentSettingsDraftKey,
  clearEditorDraft,
  getEditorDraft,
  planDraftKey,
  promptDraftKey,
  reminderDraftKey,
  setEditorDraft,
} from '@/lib/chat/editor-draft-store'
import { beforeEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

/** Mirrors the store's own cap; exceeding it must evict the oldest entries. */
const MAX_ENTRIES = 50

type PromptDraft = { name: string; content?: string }

function keysInStorage(): string[] {
  const raw = localStorage.getItem('chat-editor-drafts')
  return raw ? Object.keys(JSON.parse(raw)) : []
}

beforeEach(() => {
  for (const key of keysInStorage()) clearEditorDraft(key)
})

describe('draft keys', () => {
  test('namespace prompts, reminders and scripts apart', () => {
    expect(promptDraftKey('abc')).toBe('prompt:abc')
    expect(reminderDraftKey('abc')).toBe('reminder:abc')
    expect(SCRIPTS_DRAFT_KEY).toBe('scripts')
    expect(promptDraftKey('abc')).not.toBe(reminderDraftKey('abc'))
  })

  test('give each session its own plan draft', () => {
    expect(planDraftKey('s1')).toBe('plan:s1')
    expect(planDraftKey('s1')).not.toBe(planDraftKey('s2'))
    expect(planDraftKey('x')).not.toBe(promptDraftKey('x'))
  })

  test('give each agent its own settings draft', () => {
    expect(agentSettingsDraftKey('a1')).toBe('agent-settings:a1')
    expect(agentSettingsDraftKey('a1')).not.toBe(agentSettingsDraftKey('a2'))
    expect(USER_SETTINGS_DRAFT_KEY).toBe('user-settings')
  })

  test('never collide a settings form with an editor on the same id', () => {
    // A prompt editor and a settings form can be open at once, each holding a
    // different slice of the same unsaved work.
    expect(agentSettingsDraftKey('x')).not.toBe(promptDraftKey('x'))
    expect(agentSettingsDraftKey('x')).not.toBe(reminderDraftKey('x'))
  })
})

describe('settings form drafts', () => {
  test('round-trip a form draft with an unapplied prompt', () => {
    // The case that motivated form drafting: a prompt that was added but never
    // applied exists nowhere but the form.
    const values = {
      name: 'Agent',
      prompts: [{ id: 'p-new', name: 'Added', content: 'Typed.' }],
    }
    setEditorDraft(agentSettingsDraftKey('a1'), values)

    expect(getEditorDraft<typeof values>(agentSettingsDraftKey('a1'))).toEqual(
      values,
    )
  })

  test('keep each agent draft independent', () => {
    setEditorDraft(agentSettingsDraftKey('a1'), { name: 'One' })
    setEditorDraft(agentSettingsDraftKey('a2'), { name: 'Two' })
    clearEditorDraft(agentSettingsDraftKey('a1'))

    expect(getEditorDraft(agentSettingsDraftKey('a1'))).toBeUndefined()
    expect(
      getEditorDraft<{ name: string }>(agentSettingsDraftKey('a2')),
    ).toEqual({ name: 'Two' })
  })
})

describe('get/set/clear', () => {
  test('round-trips an arbitrary draft value', () => {
    const draft: PromptDraft = { name: 'Rewrite', content: '# hello' }
    setEditorDraft(promptDraftKey('p1'), draft)
    expect(getEditorDraft<PromptDraft>(promptDraftKey('p1'))).toEqual(draft)
  })

  test('returns undefined for an unknown key', () => {
    expect(getEditorDraft(promptDraftKey('missing'))).toBeUndefined()
  })

  test('overwrites rather than merging', () => {
    setEditorDraft(promptDraftKey('p1'), { name: 'a', content: 'x' })
    setEditorDraft(promptDraftKey('p1'), { name: 'b' })
    expect(getEditorDraft<PromptDraft>(promptDraftKey('p1'))).toEqual({
      name: 'b',
    })
  })

  test('clear removes only its own key', () => {
    setEditorDraft(promptDraftKey('p1'), { name: 'a' })
    setEditorDraft(promptDraftKey('p2'), { name: 'b' })
    clearEditorDraft(promptDraftKey('p1'))

    expect(getEditorDraft(promptDraftKey('p1'))).toBeUndefined()
    expect(getEditorDraft<PromptDraft>(promptDraftKey('p2'))).toEqual({
      name: 'b',
    })
  })

  test('clearing an absent key does not write', () => {
    setEditorDraft(promptDraftKey('p1'), { name: 'a' })
    const before = localStorage.getItem('chat-editor-drafts')
    clearEditorDraft(promptDraftKey('never-stored'))
    expect(localStorage.getItem('chat-editor-drafts')).toBe(before)
  })

  test('survives a reload, which is the point of the feature', () => {
    setEditorDraft(SCRIPTS_DRAFT_KEY, { scripts: [{ id: 's1', code: 'x' }] })
    const persisted = JSON.parse(localStorage.getItem('chat-editor-drafts')!)
    expect(persisted[SCRIPTS_DRAFT_KEY].value).toEqual({
      scripts: [{ id: 's1', code: 'x' }],
    })
  })
})

describe('eviction', () => {
  test('keeps the cap and drops the least recently touched', () => {
    for (let index = 0; index < MAX_ENTRIES; index++) {
      setEditorDraft(promptDraftKey(`p${index}`), { name: `n${index}` })
    }
    expect(keysInStorage()).toHaveLength(MAX_ENTRIES)

    setEditorDraft(promptDraftKey('newest'), { name: 'newest' })

    expect(keysInStorage()).toHaveLength(MAX_ENTRIES)
    expect(getEditorDraft<PromptDraft>(promptDraftKey('newest'))).toEqual({
      name: 'newest',
    })
    expect(getEditorDraft(promptDraftKey('p0'))).toBeUndefined()
    expect(
      getEditorDraft<PromptDraft>(promptDraftKey(`p${MAX_ENTRIES - 1}`)),
    ).toEqual({
      name: `n${MAX_ENTRIES - 1}`,
    })
  })
})
