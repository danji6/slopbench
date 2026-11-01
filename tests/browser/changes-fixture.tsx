import { ChangesSummary } from '@/components/chat/messages/changes/changes-summary'
import { GrowOnly } from '@/components/chat/messages/grow-only'
import '@/globals.css'
import { ConvexProvider, type ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
const files = Array.from({ length: 8 }, (_, index) => ({
  key: `file-${index + 1}`,
  path: `src/file-${index + 1}.ts`,
  kind: 'modified',
  additions: 1,
  deletions: 1,
  binary: false,
  truncated: false,
}))
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

const client = {
  watchQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    const key = `${name}:${JSON.stringify(args)}`
    return {
      onUpdate(listener: () => void) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      localQueryResult() {
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
      additions: empty ? 0 : 8,
      deletions: empty ? 0 : 8,
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
  return (
    <ConvexProvider client={client}>
      <main className="mx-auto max-w-3xl p-6">
        <GrowOnly data-testid="summary-row">
          <ChangesSummary messageId="message" version={1} />
        </GrowOnly>
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
    </ConvexProvider>
  )
}
