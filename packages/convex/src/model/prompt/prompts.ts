import type { ModelMessage } from '@ai-sdk/provider-utils'

import type { Prompt, PromptMarker, PromptSource } from '../../types'
import {
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
} from '../defaults'
import { findPromptMarker, promptItemKey } from './markers'
import { mergeOrderedPromptItems } from './merge'
import type { PromptOrderRef } from './merge'

type WirePrompt = Prompt
type WireMarker = PromptMarker

export type PromptItem = WirePrompt | WireMarker

export type BuiltSystemPrompt = {
  systemPrompt: string | undefined
  remainingPrompts: PromptItem[]
}

export type RenderFn = (text: string) => string

export function mergePrompts(
  source: PromptSource,
  libraryPrompts: Prompt[] = [],
): PromptItem[] {
  const ownItems = source.prompts as PromptItem[]

  if (!source.promptOrder?.length) {
    return ownItems
  }

  const order = source.promptOrder as PromptOrderRef[]
  const result = mergeOrderedPromptItems({
    ownItems,
    libraryItems: libraryPrompts,
    order,
    getOwnId: promptItemKey,
    getLibraryId: (item) => item.id,
  })

  return result.items.map(({ item }) => item)
}

export function buildSystemPrompt(
  prompts: PromptItem[],
  render: RenderFn,
): BuiltSystemPrompt {
  const systemParts: string[] = []
  let i = 0

  // Any marker ends the block; a disabled prompt is skipped
  while (i < prompts.length) {
    const item = prompts[i]
    if (!isPrompt(item) || item.role !== 'system') break
    if (item.enabled) {
      const rendered = render(item.content)
      if (rendered) systemParts.push(rendered)
    }
    i++
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    remainingPrompts: prompts.slice(i),
  }
}

export function collectStarterPrompts(prompts: PromptItem[]): Prompt[] {
  return prompts.filter(
    (item): item is Prompt => isPrompt(item) && item.enabled && isStarter(item),
  )
}

export function removeStarterPrompts(prompts: PromptItem[]) {
  return prompts.filter((item) => !isPrompt(item) || !isStarter(item))
}

export function buildPrompts(
  remainingPrompts: PromptItem[],
  allMessages: ModelMessage[],
  render: RenderFn,
): ModelMessage[] {
  const markerIndex = findPromptMarker(remainingPrompts, 'message-history')

  if (markerIndex === -1) {
    return [...toModelMessages(remainingPrompts, render), ...allMessages]
  }

  const before = remainingPrompts.slice(0, markerIndex)
  const after = remainingPrompts.slice(markerIndex + 1)

  return [
    ...toModelMessages(before, render),
    ...allMessages,
    ...toModelMessages(after, render),
  ]
}

export function buildPromptMessages(
  prompts: PromptItem[],
  render: RenderFn,
): ModelMessage[] {
  return toModelMessages(prompts, render)
}

export function resolveCompactionPrompts(prompts: Prompt[]): Prompt[] {
  return prompts.length > 0 ? prompts : createDefaultCompactionPrompts()
}

export function resolveImpersonationPrompts(prompts: Prompt[]): Prompt[] {
  return prompts.length > 0 ? prompts : createDefaultImpersonationPrompts()
}

export function buildExtraInstructions(instructions?: string) {
  const parts = []
  const trimmedInstructions = instructions?.trim()
  if (trimmedInstructions) parts.push(trimmedInstructions)
  return parts.join('\n\n')
}

function isPrompt(item: PromptItem): item is WirePrompt {
  return !('type' in item)
}

function isStarter(item: WirePrompt): boolean {
  return item.starter === true
}

function toModelMessages(
  items: PromptItem[],
  render: RenderFn,
): ModelMessage[] {
  return items
    .filter(
      (item): item is Prompt =>
        isPrompt(item) && item.enabled && !isStarter(item),
    )
    .map(
      (p) =>
        ({ role: p.role, content: render(p.content) }) satisfies ModelMessage,
    )
}
