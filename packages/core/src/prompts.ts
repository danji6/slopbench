import type { Prompt, PromptItem } from './types/prompts'

/** Narrows a prompt list entry to editable prompt content. */
export function isPrompt(item: PromptItem): item is Prompt {
  return !('type' in item)
}

/** Keeps operation prompts out of starter messages and the chat header. */
export function normalizeOperationPrompt<T extends Prompt>(prompt: T): T {
  return { ...prompt, visible: false, starter: false }
}
