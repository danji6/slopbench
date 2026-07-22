/// <reference types="bun-types" />
import { mergePrompts as mergeClientPrompts } from '@/lib/chat/prompts'
import { promptItemKey } from '@sb/convex/model/prompt/markers'
import {
  buildPrompts,
  buildSystemPrompt,
  collectStarterPrompts,
  mergePrompts as mergeServerPrompts,
  removeStarterPrompts,
} from '@sb/convex/model/prompt/prompts'
import type { Prompt, PromptItem } from '@sb/convex/types'
import { describe, expect, test } from 'bun:test'

const firstSystem: Prompt = {
  id: 'first-system',
  name: 'First System',
  role: 'system',
  content: 'First system prompt.',
  enabled: true,
  visible: false,
  starter: false,
}

const secondSystem: Prompt = {
  id: 'second-system',
  name: 'Second System',
  role: 'system',
  content: 'Second system prompt.',
  enabled: true,
  visible: false,
  starter: false,
}

const messageHistory: PromptItem = { type: 'message-history' }
const historyKey = promptItemKey(messageHistory)

const globalSystem: Prompt = {
  id: 'global-system',
  name: 'Global System',
  role: 'system',
  content: 'Global system prompt.',
  enabled: true,
  visible: false,
  starter: false,
}

describe('prompt merging', () => {
  test('server preserves unreferenced own prompt position before history', () => {
    const merged = mergeServerPrompts(
      {
        prompts: [firstSystem, secondSystem, messageHistory],
        promptOrder: [
          { kind: 'global', id: globalSystem.id },
          { kind: 'own', id: firstSystem.id },
          { kind: 'own', id: historyKey },
        ],
      },
      [globalSystem],
    )

    expect(merged.map(promptItemKey)).toEqual([
      globalSystem.id,
      firstSystem.id,
      secondSystem.id,
      historyKey,
    ])
  })

  test('client cleaned order matches displayed stale-order repair', () => {
    const merged = mergeClientPrompts(
      {
        prompts: [firstSystem, secondSystem, messageHistory],
        promptOrder: [
          { kind: 'global', id: globalSystem.id },
          { kind: 'own', id: firstSystem.id },
          { kind: 'own', id: historyKey },
        ],
      },
      [globalSystem],
    )

    expect(merged.items.map((m) => promptItemKey(m.item))).toEqual([
      globalSystem.id,
      firstSystem.id,
      secondSystem.id,
      historyKey,
    ])
    expect(merged.cleanedOrder).toEqual([
      { kind: 'global', id: globalSystem.id },
      { kind: 'own', id: firstSystem.id },
      { kind: 'own', id: secondSystem.id },
      { kind: 'own', id: historyKey },
    ])
  })

  test('server preserves explicit own prompt reorders', () => {
    const merged = mergeServerPrompts(
      {
        prompts: [firstSystem, secondSystem, messageHistory],
        promptOrder: [
          { kind: 'global', id: globalSystem.id },
          { kind: 'own', id: historyKey },
          { kind: 'own', id: firstSystem.id },
          { kind: 'own', id: secondSystem.id },
        ],
      },
      [globalSystem],
    )

    expect(merged.map(promptItemKey)).toEqual([
      globalSystem.id,
      historyKey,
      firstSystem.id,
      secondSystem.id,
    ])
  })

  test('server applies prompt order when there are no global prompts', () => {
    const merged = mergeServerPrompts(
      {
        prompts: [firstSystem, secondSystem, messageHistory],
        promptOrder: [
          { kind: 'own', id: secondSystem.id },
          { kind: 'own', id: firstSystem.id },
          { kind: 'own', id: historyKey },
        ],
      },
      [],
    )

    expect(merged.map(promptItemKey)).toEqual([
      secondSystem.id,
      firstSystem.id,
      historyKey,
    ])
  })

  test('collects enabled starter prompts in merged order', () => {
    const ownStarter: Prompt = {
      ...secondSystem,
      id: 'own-starter',
      starter: true,
    }
    const disabledStarter: Prompt = {
      ...firstSystem,
      id: 'disabled-starter',
      enabled: false,
      starter: true,
    }
    const globalStarter: Prompt = {
      ...globalSystem,
      starter: true,
    }
    const merged = mergeServerPrompts(
      {
        prompts: [disabledStarter, ownStarter],
        promptOrder: [
          { kind: 'own', id: disabledStarter.id },
          { kind: 'global', id: globalStarter.id },
          { kind: 'own', id: ownStarter.id },
        ],
      },
      [globalStarter],
    )

    expect(collectStarterPrompts(merged).map((item) => item.id)).toEqual([
      globalStarter.id,
      ownStarter.id,
    ])
  })

  test('starter prompts are removed from provider prompt construction', () => {
    const starterSystem: Prompt = {
      ...firstSystem,
      id: 'starter-system',
      content: 'Starter system prompt.',
      starter: true,
    }
    const normalSystem: Prompt = {
      ...secondSystem,
      id: 'normal-system',
      content: 'Normal system prompt.',
    }
    const normalUser: Prompt = {
      ...secondSystem,
      id: 'normal-user',
      role: 'user',
      content: 'Normal user prompt.',
    }

    const providerPrompts = removeStarterPrompts([
      starterSystem,
      normalSystem,
      normalUser,
    ])
    const { systemPrompt, remainingPrompts } = buildSystemPrompt(
      providerPrompts,
      (value) => value,
    )
    const messages = buildPrompts(remainingPrompts, [], (value) => value)

    expect(systemPrompt).toBe('Normal system prompt.')
    expect(messages).toEqual([{ role: 'user', content: 'Normal user prompt.' }])
  })
})

const libraryPrompt: Prompt = {
  id: 'library-system',
  name: 'Library System',
  role: 'system',
  content: 'Library system prompt.',
  enabled: true,
  visible: false,
  starter: false,
}

describe('library prompts', () => {
  test('server resolves referenced library prompts in order', () => {
    const merged = mergeServerPrompts(
      {
        prompts: [firstSystem, messageHistory],
        promptOrder: [
          { kind: 'own', id: firstSystem.id },
          { kind: 'library', id: libraryPrompt.id },
          { kind: 'own', id: historyKey },
        ],
      },
      [],
      [libraryPrompt],
    )

    expect(merged.map(promptItemKey)).toEqual([
      firstSystem.id,
      libraryPrompt.id,
      historyKey,
    ])
  })

  test('unreferenced library prompts are never auto-included', () => {
    const ordered = mergeServerPrompts(
      {
        prompts: [firstSystem, messageHistory],
        promptOrder: [
          { kind: 'own', id: firstSystem.id },
          { kind: 'own', id: historyKey },
        ],
      },
      [],
      [libraryPrompt],
    )
    expect(ordered.map(promptItemKey)).toEqual([firstSystem.id, historyKey])

    const unordered = mergeServerPrompts(
      { prompts: [firstSystem, messageHistory] },
      [],
      [libraryPrompt],
    )
    expect(unordered.map(promptItemKey)).toEqual([firstSystem.id, historyKey])
  })

  test('stale library references are dropped', () => {
    const merged = mergeServerPrompts(
      {
        prompts: [firstSystem],
        promptOrder: [
          { kind: 'own', id: firstSystem.id },
          { kind: 'library', id: 'missing-library-prompt' },
        ],
      },
      [],
      [libraryPrompt],
    )

    expect(merged.map(promptItemKey)).toEqual([firstSystem.id])
  })

  test('library prompts resolve even when global prompts are disabled', () => {
    const merged = mergeServerPrompts(
      {
        globalPromptsEnabled: false,
        prompts: [firstSystem],
        promptOrder: [
          { kind: 'own', id: firstSystem.id },
          { kind: 'library', id: libraryPrompt.id },
          { kind: 'global', id: globalSystem.id },
        ],
      },
      [globalSystem],
      [libraryPrompt],
    )

    expect(merged.map(promptItemKey)).toEqual([
      firstSystem.id,
      libraryPrompt.id,
    ])
  })

  test('client flags library items distinctly from globals', () => {
    const merged = mergeClientPrompts(
      {
        prompts: [firstSystem],
        promptOrder: [
          { kind: 'global', id: globalSystem.id },
          { kind: 'own', id: firstSystem.id },
          { kind: 'library', id: libraryPrompt.id },
        ],
      },
      [globalSystem],
      [libraryPrompt],
    )

    const byId = new Map(merged.items.map((m) => [promptItemKey(m.item), m]))
    expect(byId.get(libraryPrompt.id)?.isLibrary).toBe(true)
    expect(byId.get(libraryPrompt.id)?.isGlobal).toBe(false)
    expect(byId.get(globalSystem.id)?.isGlobal).toBe(true)
    expect(byId.get(globalSystem.id)?.isLibrary).toBe(false)
    expect(byId.get(firstSystem.id)?.isLibrary).toBe(false)
  })
})
