import type { OrderedItem, Prompt, PromptItem, PromptMarker } from '@/lib/chat'
import type { PromptMarkerType, PromptSource, ReminderPrompt } from '@/lib/chat'
import { mergeOrderedPromptItems } from '@sb/convex/model/prompt/merge'
import { evaluate } from '@sb/core/interpreter/evaluate'
import { hasInterpolation } from '@sb/core/interpreter/parse'
import type { EvalContext } from '@sb/core/interpreter/types'

import { generateId } from '../utils'

/** Preview eval outside of a session env. `$get/$set` are no-ops. */
export function evaluatePromptPreview(
  content: string,
  context: EvalContext,
): string {
  return hasInterpolation(content) ? evaluate(content, context) : content
}

export type MergedPromptItem = {
  item: PromptItem
  isGlobal: boolean
  isLibrary?: boolean
}

export type MergeResult = {
  items: MergedPromptItem[]
  cleanedOrder: OrderedItem[] | null
}

export function newPrompt(
  overrides?: Partial<Prompt>,
): Prompt & { starter: boolean } {
  return {
    id: generateId(),
    name: 'System',
    role: 'system',
    content: '',
    enabled: true,
    visible: false,
    starter: false,
    ...overrides,
  }
}

export function newReminderPrompt(
  overrides?: Partial<ReminderPrompt>,
): ReminderPrompt {
  return {
    id: generateId(),
    name: 'Reminder',
    role: 'system',
    content: '',
    enabled: true,
    interval: 10,
    eager: false,
    ...overrides,
  }
}

export function newPromptMarker(type: PromptMarkerType): PromptMarker {
  return {
    id: generateId(),
    type,
  }
}

export function mergePrompts(
  source: PromptSource,
  globalPrompts: Prompt[],
  libraryPrompts: Prompt[] = [],
): MergeResult {
  const globals = source.globalPromptsEnabled === false ? [] : globalPrompts

  if (!source.promptOrder) {
    return {
      items: [
        ...globals.map((p) => ({
          item: p as PromptItem,
          isGlobal: true,
        })),
        ...source.prompts.map((p) => ({ item: p, isGlobal: false })),
      ],
      cleanedOrder: null,
    }
  }

  const result = mergeOrderedPromptItems({
    ownItems: source.prompts,
    globalItems: globals,
    libraryItems: libraryPrompts,
    order: source.promptOrder,
    getGlobalId: (item) => item.id,
  })
  const items = result.items.map((entry): MergedPromptItem => ({
    item: entry.item as PromptItem,
    isGlobal: entry.kind === 'global',
    isLibrary: entry.kind === 'library',
  }))
  const cleanedOrder: OrderedItem[] | null = result.changed
    ? result.order
    : null

  return { items, cleanedOrder }
}
