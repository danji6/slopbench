import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'

import type { MessageStore } from '@/lib/chat/message-store'

const versionOf = (store: MessageStore, id: string): number =>
  store.getMessageMetadata(id)?.selectedVersion ?? 1

/**
 * Fires `onChange` with the ids of already-loaded turns whose selected version
 * changed. Newly added or removed messages are ignored, so stream growth and
 * fresh sends never trip it — only an in-place version switch does.
 */
export function useVersionChange(
  messageIds: string[],
  messageStore: MessageStore,
  onChange: (changedIds: string[]) => void,
) {
  const prevVersionsRef = useRef<Map<string, number>>(new Map())
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })

  const signature = useSyncExternalStore(messageStore.subscribe, () =>
    messageIds.map((id) => versionOf(messageStore, id)).join(','),
  )

  useLayoutEffect(() => {
    const prev = prevVersionsRef.current
    const next = new Map<string, number>()
    const changed: string[] = []
    for (const id of messageIds) {
      const version = versionOf(messageStore, id)
      next.set(id, version)
      const previous = prev.get(id)
      if (previous !== undefined && previous !== version) changed.push(id)
    }
    prevVersionsRef.current = next

    if (changed.length) onChangeRef.current(changed)
  }, [signature, messageIds, messageStore])
}
