import { useActiveSession } from '@/hooks/chat/session'
import { createUsableContext } from '@/hooks/context'
import {
  hasInFlightTool,
  hasVisibleMessageContent,
  messageActivitySignature,
} from '@/lib/chat/messages'
import { type StreamStore, createStreamStore } from '@/lib/chat/stream-store'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ChatStatus, UIMessage } from 'ai'
import { useQuery } from 'convex/react'
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react'

const [StreamStoreContext, useStreamStore] =
  createUsableContext<StreamStore>('StreamStore')

export { useStreamStore }

export function StreamStoreProvider({ children }: { children: ReactNode }) {
  const session = useActiveSession()
  const [store] = useState(createStreamStore)

  const stream =
    useQuery(
      api.chat.getActiveStream,
      session ? { sessionId: session._id } : 'skip',
    ) ?? null

  useLayoutEffect(() => {
    store.sync(stream)
  }, [store, stream])

  return (
    <StreamStoreContext.Provider value={store}>
      {children}
    </StreamStoreContext.Provider>
  )
}

export function useChatStatus(): ChatStatus {
  const store = useStreamStore()
  return useSyncExternalStore(store.subscribe, store.getNormalizedStatus)
}

export function useStreamRawStatus() {
  const store = useStreamStore()
  return useSyncExternalStore(store.subscribe, store.getRawStatus)
}

export function useStreamProcessingMessageId(): Id<'messages'> | undefined {
  const store = useStreamStore()
  return useSyncExternalStore(store.subscribe, store.getProcessingMessageId)
}

export function useStreamInvokedBy(): Id<'users'> | undefined {
  const store = useStreamStore()
  return useSyncExternalStore(store.subscribe, store.getInvokedBy)
}

export function useStreamAwaitingApproval(): boolean {
  return useStreamRawStatus() === 'awaiting_approval'
}

/** Scheduled claim time of a debounced stream (agent debounce mechanism). */
export function useStreamFireAt(): number | undefined {
  const store = useStreamStore()
  return useSyncExternalStore(store.subscribe, store.getFireAt)
}

export function useIsMessageStreaming(messageId: string): boolean {
  const store = useStreamStore()
  return useSyncExternalStore(
    store.subscribe,
    () => store.getProcessingMessageId() === messageId,
  )
}

export function useStreamInactivity(message: UIMessage): boolean {
  const isStreaming = useIsMessageStreaming(message.id)
  const isAwaitingApproval = useStreamAwaitingApproval()
  const isWaitingActive = isStreaming && !isAwaitingApproval
  const idle = useStreamIdle(messageActivitySignature(message), isWaitingActive)

  if (!isWaitingActive) return false
  if (hasInFlightTool(message)) return false

  return !hasVisibleMessageContent(message) || idle
}

const STREAM_IDLE_MS = 1000

function useStreamIdle(signature: string, active: boolean): boolean {
  const [idleSignature, setIdleSignature] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setIdleSignature(signature), STREAM_IDLE_MS)
    return () => clearTimeout(timer)
  }, [signature, active])

  return active && idleSignature === signature
}
