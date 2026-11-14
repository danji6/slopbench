import { ChangesSummary } from '@/components/chat/messages/changes/changes-summary'
import { GrowOnly } from '@/components/chat/messages/grow-only'
import '@/globals.css'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'
import { useState } from 'react'

import { ChangesTranscript } from './changes-transcript'

const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
const subscriptions = new Map<string, number>()
const params = new URLSearchParams(location.search)
const delayed = params.has('delayed')
const binaryMode = params.get('binary')
const ready = new Set<string>()
const files = Array.from({ length: 8 }, (_, index) => {
  const binary = binaryMode === 'all' || (binaryMode === 'mixed' && index === 0)
  return {
    key: `file-${index + 1}`,
    path: `src/file-${index + 1}.${binary ? 'png' : 'ts'}`,
    kind: 'modified',
    additions: binary ? 0 : 1,
    deletions: binary ? 0 : 1,
    binary,
    truncated: false,
  }
})
const textFileCount = files.filter((file) => !file.binary).length
let state = 'applied'
let phase = 'ready'
let revision = 0
let conflicts: string[] = []
let issues: string[] = []
let error: string | undefined
let empty = false
const notify = () => {
  cache.clear()
  for (const listener of listeners) listener()
}

/** Mimics query eviction when its last subscriber leaves the virtualized row. */
function subscribe(name: string, key: string, listener: () => void) {
  subscriptions.set(key, (subscriptions.get(key) ?? 0) + 1)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    const remaining = subscriptions.get(key)! - 1
    if (remaining) {
      subscriptions.set(key, remaining)
      return
    }
    subscriptions.delete(key)
    cache.delete(key)
    const stillSubscribed = [...subscriptions.keys()].some((key) =>
      key.startsWith(`${name}:`),
    )
    if (!stillSubscribed) ready.delete(name)
  }
}

const client = {
  watchQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    const key = `${name}:${JSON.stringify(args)}`
    return {
      onUpdate: (listener: () => void) => subscribe(name, key, listener),
      localQueryResult() {
        if (delayed && !ready.has(name)) return undefined
        if (!cache.has(key)) cache.set(key, result(name, args))
        return cache.get(key)
      },
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  async mutation() {
    phase = 'restoring'
    notify()
  },
} as unknown as ConvexReactClient

function result(name: string, args: Record<string, unknown>) {
  if (name === 'chat:changeSummary')
    return {
      _id: 'changes',
      phase,
      state,
      revision,
      fileCount: empty ? 0 : files.length,
      additions: empty ? 0 : textFileCount,
      deletions: empty ? 0 : textFileCount,
      issues,
      error,
      conflicts,
      canRestore: true,
    }
  if (name === 'chat:changeFiles') {
    const { cursor, numItems } = args.paginationOpts as {
      cursor: string | null
      numItems: number
    }
    const offset = Number(cursor ?? 0)
    const end = Math.min(files.length, offset + numItems)
    return {
      page: files.slice(offset, end),
      isDone: end === files.length,
      continueCursor: String(end),
    }
  }
  if (name === 'chat:changeDiff') {
    if (params.has('networkDiff'))
      return `${location.origin}/diff/${args.fileKey}.patch`
    if (files.find((file) => file.key === args.fileKey)?.binary)
      return 'data:text/plain;charset=utf-8,Binary%20file%20changed.'
    const lines = Array.from(
      { length: 120 },
      (_, index) => ` context ${index}`,
    ).join('\n')
    const diff = `--- file.ts\n+++ file.ts\n@@ -1,121 +1,121 @@\n-before ${args.fileKey}\n+after ${args.fileKey}\n${lines}`
    return `data:text/plain;charset=utf-8,${encodeURIComponent(diff)}`
  }
  return null
}

export function ChangesFixture() {
  const [visible, setVisible] = useState(true)
  return (
    <ConvexProvider client={client}>
      <ConvexQueryCacheProvider>
        <main className="mx-auto max-w-3xl p-6">
          {params.has('transcript') ? (
            <ChangesTranscript>
              <ChangesSummary messageId="message" version={1} />
            </ChangesTranscript>
          ) : (
            visible && (
              <GrowOnly data-testid="summary-row">
                <ChangesSummary messageId="message" version={1} />
              </GrowOnly>
            )
          )}
          {delayed && (
            <>
              <button onClick={() => setVisible(!visible)}>
                {visible ? 'Unmount summary' : 'Remount summary'}
              </button>
              {['changeSummary', 'changeFiles'].map((query) => (
                <button
                  key={query}
                  onClick={() => {
                    ready.add(`chat:${query}`)
                    notify()
                  }}
                >
                  Resolve {query}
                </button>
              ))}
            </>
          )}
          <button
            onClick={() => {
              state = state === 'applied' ? 'reverted' : 'applied'
              phase = 'ready'
              revision++
              conflicts = []
              notify()
            }}
          >
            Complete operation
          </button>
          <button
            onClick={() => {
              phase = 'ready'
              conflicts = ['src/file-2.ts']
              notify()
            }}
          >
            Report conflict
          </button>
          <button
            onClick={() => {
              issues = [
                `${'/project/.data/sidecar/agents/owner/home/'.repeat(8)}: Error: Command failed: git ls-files\nfatal: directory entry not superset of prefix`,
              ]
              notify()
            }}
          >
            Report capture issue
          </button>
          <button
            onClick={() => {
              empty = true
              issues = ['Permission denied in an unrelated directory']
              notify()
            }}
          >
            Report no changes
          </button>
          <button
            onClick={() => {
              error =
                'Could not restore changes.\nThe local server is unavailable.'
              notify()
            }}
          >
            Report restore error
          </button>
        </main>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
