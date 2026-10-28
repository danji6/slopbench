import type { MessagesWindowResult } from '@sb/convex/model/chat/queries'
import type { MessageWindowArgs } from '@sb/convex/types'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

/** Supplies cached or explicitly deferred window responses without module mocks. */
export function messageWindowClient(
  read: (args: MessageWindowArgs) => MessagesWindowResult,
) {
  const calls: MessageWindowArgs[] = []
  const cache = new Map<string, unknown>()
  const pending = new Map<string, MessageWindowArgs>()
  const listeners = new Set<() => void>()
  let deferred = false
  const client = {
    watchQuery(reference: FunctionReference<'query'>, args: MessageWindowArgs) {
      const name = getFunctionName(reference)
      const key = `${name}:${JSON.stringify(args)}`
      return {
        onUpdate(callback: () => void) {
          listeners.add(callback)
          return () => listeners.delete(callback)
        },
        localQueryResult() {
          if (!cache.has(key)) {
            if (name === 'chat:messagesWindow') {
              calls.push(args)
              if (deferred) pending.set(key, args)
              cache.set(key, deferred ? undefined : read(args))
            } else cache.set(key, [])
          }
          return cache.get(key)
        },
        localQueryLogs: () => [],
        journal: () => undefined,
      }
    },
  } as unknown as ConvexReactClient
  return {
    client,
    calls,
    defer() {
      deferred = true
    },
    resolve() {
      deferred = false
      for (const [key, args] of pending) cache.set(key, read(args))
      pending.clear()
      listeners.forEach((listener) => listener())
    },
    resolveNext() {
      const next = pending.entries().next().value
      if (!next) return
      const [key, args] = next
      cache.set(key, read(args))
      pending.delete(key)
      listeners.forEach((listener) => listener())
    },
  }
}
