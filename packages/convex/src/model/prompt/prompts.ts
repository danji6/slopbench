import type { ModelMessage } from '@ai-sdk/provider-utils'

import type { Prompt, PromptMarker, PromptSource } from '../../types'
import {
  DEFAULT_SUBAGENT_PLAN_PROMPT,
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
  createDefaultPlanPrompts,
} from '../defaults'
import { PROMPT_MARKERS } from './markers'
import { mergeOrderedPromptItems } from './merge'
import type { PromptOrderRef } from './merge'

type WirePrompt = Prompt
type WireMarker = PromptMarker

export type WirePromptItem = WirePrompt | WireMarker

export type BuiltSystemPrompt = {
  systemPrompt: string | undefined
  remainingPrompts: WirePromptItem[]
}

export type RenderFn = (text: string) => string

export function mergePrompts(
  source: PromptSource,
  globalPrompts: Prompt[],
  libraryPrompts: Prompt[] = [],
): WirePromptItem[] {
  const ownItems = source.prompts as WirePromptItem[]
  const globals = source.globalPromptsEnabled === false ? [] : globalPrompts

  if (!source.promptOrder?.length) {
    return [...globals, ...ownItems]
  }

  const order = source.promptOrder as PromptOrderRef[]
  const result = mergeOrderedPromptItems({
    ownItems,
    globalItems: globals,
    libraryItems: libraryPrompts,
    order,
    getGlobalId: (item) => item.id,
  })

  return result.items.map(({ item }) => item)
}

export function buildSystemPrompt(
  prompts: WirePromptItem[],
  render: RenderFn,
): BuiltSystemPrompt {
  const systemParts: string[] = []
  let i = 0

  while (i < prompts.length) {
    const item = prompts[i]
    if (!isPrompt(item) || item.role !== 'system' || !item.enabled) break
    systemParts.push(render(item.content))
    i++
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    remainingPrompts: prompts.slice(i),
  }
}

export function collectStarterPrompts(prompts: WirePromptItem[]): Prompt[] {
  return prompts.filter(
    (item): item is Prompt => isPrompt(item) && item.enabled && isStarter(item),
  )
}

export function removeStarterPrompts(prompts: WirePromptItem[]) {
  return prompts.filter((item) => !isPrompt(item) || !isStarter(item))
}

export function buildPrompts(
  remainingPrompts: WirePromptItem[],
  allMessages: ModelMessage[],
  render: RenderFn,
): ModelMessage[] {
  const markerIndex = remainingPrompts.findIndex(isMessageHistoryMarker)

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
  prompts: WirePromptItem[],
  render: RenderFn,
): ModelMessage[] {
  return toModelMessages(prompts, render)
}

export function splitAtMessageHistory(prompts: WirePromptItem[]) {
  const markerIndex = prompts.findIndex(isMessageHistoryMarker)

  if (markerIndex === -1) {
    return {
      beforeHistory: prompts,
      afterHistory: [],
    }
  }

  return {
    beforeHistory: prompts.slice(0, markerIndex),
    afterHistory: prompts.slice(markerIndex + 1),
  }
}

export function resolveCompactionPrompts(prompts: unknown): WirePromptItem[] {
  return hasPromptItems(prompts)
    ? prompts
    : (createDefaultCompactionPrompts() as WirePromptItem[])
}

export function resolveImpersonationPrompts(
  prompts: unknown,
): WirePromptItem[] {
  return hasPromptItems(prompts)
    ? prompts
    : (createDefaultImpersonationPrompts() as WirePromptItem[])
}

export function resolvePlanPrompts(
  prompts: unknown,
  subagent = false,
): WirePromptItem[] {
  if (hasPromptItems(prompts)) return prompts
  return createDefaultPlanPrompts(
    subagent ? DEFAULT_SUBAGENT_PLAN_PROMPT : undefined,
  ) as WirePromptItem[]
}

export function buildExtraInstructions(instructions?: string) {
  const parts = []
  const trimmedInstructions = instructions?.trim()
  if (trimmedInstructions) parts.push(trimmedInstructions)
  return parts.join('\n\n')
}

function hasPromptItems(value: unknown): value is WirePromptItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isWirePrompt(item) || isWireMarker(item))
  )
}

function isWirePrompt(item: unknown): item is WirePrompt {
  if (typeof item !== 'object' || item === null || 'type' in item) return false
  const candidate = item as Partial<WirePrompt>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.role === 'system' ||
      candidate.role === 'user' ||
      candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.enabled === 'boolean' &&
    typeof candidate.visible === 'boolean' &&
    (candidate.starter === undefined || typeof candidate.starter === 'boolean')
  )
}

function isWireMarker(item: unknown): item is WireMarker {
  if (typeof item !== 'object' || item === null || !('type' in item)) {
    return false
  }
  const candidate = item as Partial<WireMarker>
  return (
    typeof candidate.id === 'string' &&
    candidate.type !== undefined &&
    PROMPT_MARKERS.includes(candidate.type)
  )
}

function isPrompt(item: WirePromptItem): item is WirePrompt {
  return !('type' in item)
}

function isStarter(item: WirePrompt): boolean {
  return item.starter === true
}

function isMarker(item: WirePromptItem): item is WireMarker {
  return 'type' in item
}

function isMessageHistoryMarker(item: WirePromptItem): item is WireMarker {
  return isMarker(item) && item.type === 'message-history'
}

function toModelMessages(
  items: WirePromptItem[],
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
