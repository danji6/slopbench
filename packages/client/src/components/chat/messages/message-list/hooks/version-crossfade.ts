import type { MessageStore } from '@/lib/chat/message-store'

import { useVersionChange } from '@/hooks/chat/message-version'

/** Re-triggers the one-shot fade on a content block. */
const fade = (el: HTMLElement) => {
  el.removeAttribute('data-version-swap')
  // Force a reflow so the animation restarts on a rapid re-switch
  void el.offsetWidth
  el.setAttribute('data-version-swap', '1')
  el.addEventListener(
    'animationend',
    () => el.removeAttribute('data-version-swap'),
    { once: true },
  )
}

/**
 * Fades a turn's content in when its version is switched, smoothing the swap.
 * Content blocks remount on the switch, so the fade runs on the fresh nodes.
 * Driven through a `data-*` attribute (not a class) so React reconciliation
 * doesn't clobber it. Scoped to the changed turn, so scrolling never animates.
 */
export function useVersionCrossfade(
  messageIds: string[],
  messageStore: MessageStore,
) {
  useVersionChange(messageIds, messageStore, (changedIds) => {
    for (const id of changedIds) {
      const blocks = document.querySelectorAll<HTMLElement>(
        `[data-message-id="${CSS.escape(id)}"] [data-slot="message-group"]`,
      )
      blocks.forEach(fade)
    }
  })
}
