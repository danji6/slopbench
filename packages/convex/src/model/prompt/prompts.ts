import type { ModelMessage } from '@ai-sdk/provider-utils'

import type { Prompt, PromptMarker, PromptSource } from '../../types'
import {
  createDefaultCompactionPrompts,
  createDefaultImpersonationPrompts,
} from '../defaults'
import { PROMPT_MARKERS, findPromptMarker, promptItemKey } from './markers'
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
  globalPrompts: Prompt[],
  libraryPrompts: Prompt[] = [],
): PromptItem[] {
  const ownItems = source.prompts as PromptItem[]
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
    getOwnId: promptItemKey,
    getGlobalId: (item) => item.id,
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

export function splitAtMessageHistory(prompts: PromptItem[]) {
  const markerIndex = findPromptMarker(prompts, 'message-history')

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

/**
 * Splices an agent's own prompts into an operation's framing list at its
 * `agent-prompts` marker, which is consumed in the process. Without the marker
 * they go just before the message history, or at the end when there is none.
 */
export function spliceAgentPrompts(
  framing: PromptItem[],
  agentPrompts: PromptItem[],
): PromptItem[] {
  const at = findPromptMarker(framing, 'agent-prompts')
  const fallback = findPromptMarker(framing, 'message-history')
  const index = at !== -1 ? at : fallback !== -1 ? fallback : framing.length

  return [
    ...framing.slice(0, index),
    ...agentPrompts,
    ...framing.slice(at !== -1 ? at + 1 : index),
  ]
}

export function resolveCompactionPrompts(prompts: unknown): PromptItem[] {
  return hasPromptItems(prompts)
    ? prompts
    : (createDefaultCompactionPrompts() as PromptItem[])
}

export function resolveImpersonationPrompts(prompts: unknown): PromptItem[] {
  return hasPromptItems(prompts)
    ? prompts
    : (createDefaultImpersonationPrompts() as PromptItem[])
}

export function buildExtraInstructions(instructions?: string) {
  const parts = []
  const trimmedInstructions = instructions?.trim()
  if (trimmedInstructions) parts.push(trimmedInstructions)
  return parts.join('\n\n')
}

function hasPromptItems(value: unknown): value is PromptItem[] {
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
  return candidate.type !== undefined && PROMPT_MARKERS.includes(candidate.type)
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
