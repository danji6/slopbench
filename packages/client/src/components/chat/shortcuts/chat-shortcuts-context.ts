import { createOptionalContext } from '@/hooks/context'

export type ChatShortcutsValue = {
  /**
   * Fires an attempt to edit the latest user message.
   * @returns `true` if it succeeds, `false` otherwise.
   */
  editLatestUserMessage: () => boolean
}

export const [ChatShortcutsContext, useChatShortcuts] =
  createOptionalContext<ChatShortcutsValue>()
