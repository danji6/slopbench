import { registerAvatarIds } from '@/hooks/chat/avatars'
import { useMessageWindow } from '@/hooks/chat/message-window'
import { useActiveSession } from '@/hooks/chat/session'
import { useSettings } from '@/hooks/chat/settings'
import { useStreamStore } from '@/hooks/chat/stream'
import { createUsableContext } from '@/hooks/context'
import { ChatError, ChatWarning, RateLimitError } from '@/lib/chat/errors'
import {
  type MessageStore,
  type MessageWindowMetadata,
  type WindowControls,
  createMessageStore,
} from '@/lib/chat/message-store'
import { convertMessages, isMessageEmpty } from '@/lib/chat/messages'
import type { MessageRow } from '@/lib/chat/rows'
import type { UIMetadata } from '@/lib/chat/types'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { UIMessage } from 'ai'
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

const [MessageStoreContext, useMessageStore] =
  createUsableContext<MessageStore>('MessageStore')

export { useMessageStore }

export function ChatMessagesProvider({ children }: { children: ReactNode }) {
  const session = useActiveSession()
  const settings = useSettings()
  const [store] = useState(createMessageStore)

  const { messages, meta, controls, resetKey } = useMessageWindow(
    session?._id ?? null,
  )

  const converted = useMemo(() => {
    const conversion = convertMessages(messages)
    const filtered = conversion.messages.filter(
      (message) =>
        message.role !== 'assistant' ||
        message.status === 'processing' ||
        !isMessageEmpty(message) ||
        // For error propagation
        Boolean(conversion.byId.get(message.id)?.metadata?.error),
    )
    return { ...conversion, messages: filtered }
  }, [messages])

  const groupBySender =
    settings?.groupBySender ?? DEFAULT_SETTINGS.groupBySender

  useLayoutEffect(() => {
    store.sync({
      sessionId: session?._id ?? null,
      results: converted.messages,
      controls,
      meta,
      resetKey,
      messageMetaByMessage: converted.byId,
      partMetaByMessage: converted.partMetaById,
      groupBySender,
    })
  }, [store, session?._id, converted, controls, meta, resetKey, groupBySender])

  // Eagerly start the avatar cache
  useLayoutEffect(() => {
    const ids = [...converted.byId.values()].map(
      (m) => m.senderSnapshot?.avatarId,
    )
    registerAvatarIds([...ids, settings?.avatarId])
  }, [converted, settings?.avatarId])

  return (
    <MessageStoreContext.Provider value={store}>
      {children}
    </MessageStoreContext.Provider>
  )
}

export function useMessageIds(): string[] {
  const store = useMessageStore()
  return useSyncExternalStore(store.subscribe, store.getIds)
}

export function useMessageRows(): MessageRow[] {
  const store = useMessageStore()
  return useSyncExternalStore(store.subscribe, store.getRows)
}

export function useWindowMetadata(): MessageWindowMetadata {
  const store = useMessageStore()
  return useSyncExternalStore(store.subscribe, store.getWindowMetadata)
}

export function useWindowControls(): WindowControls {
  const store = useMessageStore()
  return useSyncExternalStore(store.subscribe, store.getControls)
}

/** Whether newer messages have arrived while the user is scrolled up. */
export function useUnseenTailActivity(isAtBottom: boolean): boolean {
  const store = useMessageStore()
  const ids = useSyncExternalStore(store.subscribe, store.getIds)
  const { isAtLiveTail } = useWindowMetadata()
  const [unseen, setUnseen] = useState(false)
  const seenRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    const last = ids[ids.length - 1]
    const seen = seenRef.current

    const caughtUp =
      isAtBottom ||
      !isAtLiveTail ||
      seen === undefined ||
      !store.getMessage(seen)

    if (caughtUp) {
      seenRef.current = last
      setUnseen(false)
      return
    }

    setUnseen(last !== undefined && last !== seen)
  }, [ids, isAtBottom, isAtLiveTail, store])

  return unseen
}

/** Only use this in leaf components, as it re-renders on every stream delta. */
export function useAllMessages(): UIMessage[] {
  const store = useMessageStore()
  return useSyncExternalStore(store.subscribe, store.getResults)
}

/** Granular single message hook. */
export function useChatMessage(messageId: string) {
  const store = useMessageStore()
  const message = useSyncExternalStore(store.subscribe, () =>
    store.getMessage(messageId),
  )
  const isLast = useSyncExternalStore(store.subscribe, () =>
    store.getIsLast(messageId),
  )
  const agentId = useSyncExternalStore(store.subscribe, () =>
    store.getagentId(messageId),
  )
  const messageMeta = useSyncExternalStore(store.subscribe, () =>
    store.getMessageMetadata(messageId),
  )
  const partMeta = useSyncExternalStore(store.subscribe, () =>
    store.getPartMetadata(messageId),
  )

  return { message, isLast, agentId, messageMeta, partMeta }
}

/** Whether the session has messages newer than the given one. */
export function useHasNewerMessages(messageId: string): boolean {
  const store = useMessageStore()
  const isLast = useSyncExternalStore(store.subscribe, () =>
    store.getIsLast(messageId),
  )
  const { canLoadNewer } = useWindowMetadata()
  return !isLast || canLoadNewer
}

export function useChatError(
  dismissedKeys?: ReadonlySet<string>,
): Error | null {
  const streamStore = useStreamStore()
  const rawStatus = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getRawStatus,
  )
  const retryAt = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getRetryAt,
  )
  const retryError = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getRetryError,
  )
  const attempt = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getAttempt,
  )
  const streamId = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getStreamId,
  )
  const store = useMessageStore()
  const ids = useSyncExternalStore(store.subscribe, store.getIds)

  // For error propagation
  const metaByMessage = useSyncExternalStore(
    store.subscribe,
    store.getMessageMetaMap,
  )

  return useMemo(() => {
    if (rawStatus === 'retrying' && retryAt !== undefined) {
      return new RateLimitError(0, attempt ?? 0, 0, retryAt)
    }
    if (retryError) {
      const key = `retry:${streamId}:${retryError}`
      if (!dismissedKeys?.has(key)) {
        return new ChatError(retryError, 500, key)
      }
    }

    const lastId = ids[ids.length - 1]
    const error = lastId
      ? metaByMessage.get(lastId)?.metadata?.error
      : undefined

    if (error) {
      const key = `error:${lastId}:${error}`
      if (!dismissedKeys?.has(key)) return new ChatError(error, 500, key)
    }

    for (let index = ids.length - 1; index >= 0; index--) {
      const id = ids[index]
      const warnings = metaByMessage.get(id)?.metadata?.warnings ?? []

      for (const [warningIndex, warning] of warnings.entries()) {
        const key = `${id}:${warningIndex}:${warning}`
        if (!dismissedKeys?.has(key)) return new ChatWarning(warning, key)
      }
    }

    return null
  }, [
    rawStatus,
    retryAt,
    retryError,
    attempt,
    streamId,
    ids,
    metaByMessage,
    dismissedKeys,
  ])
}

export function useChatMetadata(): UIMetadata | undefined {
  const store = useMessageStore()
  const ids = useSyncExternalStore(store.subscribe, store.getIds)
  const metaByMessage = useSyncExternalStore(
    store.subscribe,
    store.getMessageMetaMap,
  )
  const usage = findLatestUsage(ids, metaByMessage)

  return usage ? { usage } : undefined
}

function findLatestUsage(
  ids: string[],
  metaByMessage: Map<string, { metadata?: { usage?: UIMetadata['usage'] } }>,
): UIMetadata['usage'] | undefined {
  for (let index = ids.length - 1; index >= 0; index--) {
    const usage = metaByMessage.get(ids[index])?.metadata?.usage
    if (usage) return usage
  }
}
