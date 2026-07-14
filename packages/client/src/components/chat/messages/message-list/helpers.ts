import type { useMessageStore } from '@/hooks/chat'
import type { MessageRow } from '@/lib/chat/rows'
import { useEffect, useState } from 'react'

/** Delays showing `visible` by `delay` ms, hiding immediately when it clears. */
export function useDelayedVisibility(visible: boolean, delay: number) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setIsVisible(visible),
      visible ? delay : 0,
    )
    return () => window.clearTimeout(timeoutId)
  }, [delay, visible])

  return isVisible
}

/** The suffix of `current` appended after `previous` (empty if not a pure append). */
export function appendedMessageIds(
  previous: string[],
  current: string[],
): string[] {
  if (current.length <= previous.length) return []
  for (let index = 0; index < previous.length; index++) {
    if (previous[index] !== current[index]) return []
  }
  return current.slice(previous.length)
}

export function latestRemoteUserMessageId(
  ids: string[],
  store: ReturnType<typeof useMessageStore>,
  localUserId: string,
): string | null {
  for (let index = ids.length - 1; index >= 0; index--) {
    const id = ids[index]
    const message = store.getMessage(id)
    const metadata = store.getMessageMetadata(id)

    if (
      message?.role === 'user' &&
      metadata?.sender.type === 'user' &&
      metadata.sender.id !== localUserId
    ) {
      return id
    }
  }

  return null
}

export function firstMessageRowIndex(
  rows: MessageRow[],
  messageId: string,
): number {
  return rows.findIndex((row) => row.messageId === messageId)
}
