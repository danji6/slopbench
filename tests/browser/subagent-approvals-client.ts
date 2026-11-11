import { api } from '@sb/convex/_generated/api'
import type { WindowMessage } from '@sb/convex/model/chat/queries'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import type { OptimisticLocalStore } from 'convex/browser'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

type Part = {
  type: 'tool-shell'
  wireCall?: { name: string; input: unknown }
  toolCallId: string
  input: { command: string }
  state: string
  approval: { id: string; approved?: boolean; note?: string }
}

const part = (id: string): Part => ({
  type: 'tool-shell',
  toolCallId: id,
  ...(new URLSearchParams(location.search).has('dispatched')
    ? {
        wireCall: {
          name: 'call_tool',
          input: {
            name: 'shell',
            arguments: { command: `git push origin ${id}` },
          },
        },
      }
    : {}),
  input: { command: `git push origin ${id}` },
  state: 'approval-requested',
  approval: { id },
})

const hasLocalApproval = new URLSearchParams(location.search).has('localApproval') // prettier-ignore
const deferSend = new URLSearchParams(location.search).has('deferSend')

let requests = [
  ...(hasLocalApproval
    ? [
        {
          sessionId: 'parent',
          title: 'Parent',
          agentName: 'Writer',
          parts: [part('local')],
        },
      ]
    : []),
  {
    sessionId: 'child',
    title: 'Explore task',
    agentName: 'Explore',
    parts: [part('first'), part('second')],
  },
  {
    sessionId: 'sibling',
    title: 'Sibling task',
    agentName: 'Writer',
    parts: [part('sibling')],
  },
]
let stopped: string[] = []
let failNext = false
let resolvePending: (() => void) | undefined
const mutations: { name: string; args: Record<string, unknown> }[] = []
type Entry = {
  reference: FunctionReference<'query'>
  args: Record<string, unknown>
  value: unknown
}
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
const sent: WindowMessage[] = []
let attachmentCount = 0
let attachmentUrlsReady = false
let typingCount = Number(
  new URLSearchParams(location.search).get('typing') ?? 0,
)
let approvalsReady = !new URLSearchParams(location.search).has('delayedApprovals') // prettier-ignore
const key = (reference: FunctionReference<'query'>, args: unknown) =>
  `${getFunctionName(reference)}:${JSON.stringify(args)}`

function notify() {
  for (const listener of listeners) listener()
}

window.addEventListener('release-attachment-urls', () => {
  attachmentUrlsReady = true
  cache.clear()
  notify()
})

function pendingParts(sessionId: string) {
  return (
    requests
      .find((request) => request.sessionId === sessionId)
      ?.parts.filter((part) => part.state === 'approval-requested') ?? []
  )
}

function stream(sessionId: string) {
  if (sessionId === 'parent' && (!hasLocalApproval || !approvalsReady)) return null // prettier-ignore
  if (stopped.includes(sessionId)) return null
  return {
    _id: `${sessionId}_stream`,
    sessionId,
    processingMessageId: `${sessionId}_message`,
    status: pendingParts(sessionId).length ? 'awaiting_approval' : 'pending',
    invokedBy: 'owner',
  }
}

function messageWindow(sessionId: string) {
  const request = requests.find((request) => request.sessionId === sessionId)
  const page = request
    ? [
        {
          _id: `${sessionId}_message`,
          _creationTime: 1,
          sessionId,
          role: 'assistant',
          sender: { type: 'agent', id: 'agent' },
          senderName: request.agentName,
          status: 'processing',
          selectedVersion: 1,
          versionCount: 1,
          segments: [{ segmentIndex: 0, parts: [], sizeBytes: 0, live: true }],
          sizeBytes: 0,
          hasOlderSegments: false,
          hasNewerSegments: false,
        },
      ]
    : []
  const history = new URLSearchParams(location.search).has('history')
    ? historyMessages(sessionId)
    : []
  return {
    page: [
      ...history,
      ...page,
      ...sent.filter((message) => message.sessionId === sessionId),
    ],
    hasOlder: false,
    hasNewer: false,
    atTail: true,
  }
}

function historyMessages(sessionId: string) {
  return Array.from({ length: 32 }, (_, index) => ({
    _id: `history-${index}`,
    _creationTime: index + 1,
    sessionId,
    role: 'user',
    sender: { type: 'user', id: 'owner' },
    senderName: 'Owner',
    status: 'done',
    selectedVersion: 1,
    versionCount: 1,
    segments: [
      {
        segmentIndex: 0,
        parts: [{ type: 'text', text: `History message ${index + 1}` }],
        sizeBytes: 64,
      },
    ],
    sizeBytes: 64,
    hasOlderSegments: false,
    hasNewerSegments: false,
  }))
}

function query(name: string, args: Record<string, unknown>) {
  const sessionId = String(args.sessionId ?? '')
  if (name === 'typing:list') {
    return ['Alice', 'Bob', 'Carol', 'Dave', 'Eve']
      .slice(0, typingCount)
      .map((name) => ({ userId: name, name, expiresAt: Date.now() + 60_000 }))
  }
  if (name === 'users:getProfile')
    return {
      _id: 'owner',
      role: new URLSearchParams(location.search).has('nonAdmin')
        ? 'user'
        : 'admin',
    }
  if (name === 'settings:get') return DEFAULT_SETTINGS
  if (name === 'sessions:get')
    return {
      _id: sessionId,
      ownerId: 'owner',
      title: sessionId === 'parent' ? 'Parent' : 'Explore task',
      ...(sessionId !== 'parent' ? { parent: { sessionId: 'parent' } } : {}),
    }
  if (name === 'sessions:getState') return { toolApprovals: {} }
  if (name === 'chat:getActiveStream') return stream(sessionId)
  if (name === 'chat:messagesWindow') return messageWindow(sessionId)
  if (name === 'attachments:getUrlMap') {
    if (!attachmentUrlsReady) return {}
    return Object.fromEntries(
      (args.ids as string[]).map((id) => [
        id,
        {
          url: `${location.origin}/composer-file/${id}`,
          previewUrl: `${location.origin}/composer-file/${id}`,
        },
      ]),
    )
  }
  if (name === 'chat:processingMessageSegments') {
    const request = requests.find((request) => request.sessionId === sessionId)
    return request
      ? [
          {
            messageId: `${sessionId}_message`,
            selectedVersion: 1,
            segment: { segmentIndex: 0, parts: request.parts, sizeBytes: 100 },
          },
        ]
      : []
  }
  if (name === 'subagents:pendingApprovals')
    return (approvalsReady && !deferSend ? requests : [])
      .filter(
        (request) =>
          request.sessionId !== 'parent' &&
          !stopped.includes(request.sessionId),
      ) // prettier-ignore
      .map((request) => ({
        ...request,
        toolApprovals: {},
        parts: pendingParts(request.sessionId),
      }))
      .filter((request) => request.parts.length)
  if (name.endsWith(':list') || name === 'streams:activeSessionIds') return []
  return null
}

const optimisticStore = {
  getQuery: (reference: FunctionReference<'query'>, args: unknown) =>
    cache.get(key(reference, args))?.value,
  getAllQueries: (reference: FunctionReference<'query'>) =>
    [...cache.values()].filter(
      (entry) =>
        getFunctionName(entry.reference) === getFunctionName(reference),
    ),
  setQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
    value: unknown,
  ) {
    cache.set(key(reference, args), { reference, args, value })
  },
} as unknown as OptimisticLocalStore

type FixtureOptimisticUpdate = (
  store: OptimisticLocalStore,
  args: Record<string, unknown>,
) => void

async function sendMessage(
  args: Record<string, unknown>,
  update?: FixtureOptimisticUpdate,
) {
  update?.(optimisticStore, args)
  const windowQuery = optimisticStore
    .getAllQueries(api.chat.messagesWindow)
    .find(
      (query) =>
        query.args.sessionId === args.sessionId && query.args.anchor === null,
    )
  const pending = windowQuery?.value?.page.at(-1)
  notify()

  const success = await new Promise<boolean>((resolve) => {
    window.addEventListener(
      'complete-send',
      (event) => {
        resolve((event as CustomEvent<boolean>).detail)
      },
      { once: true },
    )
  })
  if (success && pending) {
    sent.push({
      ...pending,
      _id: `sent-${sent.length}` as WindowMessage['_id'],
    })
  }
  cache.clear()
  notify()
  if (!success) throw new Error('Fixture send failure')
  return 'sent-message'
}

async function respond(
  args: Record<string, unknown>,
  update?: FixtureOptimisticUpdate,
) {
  if (
    args.sessionId !== 'parent' ||
    (!args.childSessionId && !hasLocalApproval)
  ) {
    throw new Error(
      'Child approvals must use the parent/child mutation arguments',
    )
  }
  const snapshot = new Map(cache)
  update?.(optimisticStore, args)
  notify()
  await new Promise<void>((resolve) => {
    resolvePending = resolve
  })
  resolvePending = undefined
  if (failNext) {
    failNext = false
    cache.clear()
    for (const [key, entry] of snapshot) cache.set(key, entry)
    notify()
    throw new Error('Fixture approval failure')
  }
  const owningSession = args.childSessionId ?? args.sessionId
  requests = requests.map((request) =>
    request.sessionId === owningSession
      ? {
          ...request,
          parts: request.parts.map((part) =>
            part.toolCallId === args.toolCallId
              ? {
                  ...part,
                  state: args.approved ? 'approval-responded' : 'output-denied',
                  approval: {
                    ...part.approval,
                    approved: Boolean(args.approved),
                    note: args.note as string | undefined,
                  },
                }
              : part,
          ),
        }
      : request,
  )
}

export const approvalFixtureClient = {
  watchQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown>,
  ) {
    const queryKey = key(reference, args)
    return {
      onUpdate(callback: () => void) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      localQueryResult() {
        if (!cache.has(queryKey))
          cache.set(queryKey, {
            reference,
            args,
            value: query(getFunctionName(reference), args),
          })
        return cache.get(queryKey)?.value
      },
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  async mutation(
    reference: FunctionReference<'mutation'>,
    args: Record<string, unknown>,
    options?: {
      optimisticUpdate?: FixtureOptimisticUpdate
    },
  ) {
    const name = getFunctionName(reference)
    mutations.push({ name, args })
    if (name === 'chat:approveTool')
      await respond(args, options?.optimisticUpdate)
    else if (name === 'chat:sendMessage') {
      if (deferSend) return sendMessage(args, options?.optimisticUpdate)
      notify()
      return 'sent-message'
    } else if (name === 'attachments:generateUploadUrl') {
      return `${location.origin}/composer-upload`
    } else if (name === 'attachments:confirm') {
      return `attachment-${++attachmentCount}`
    } else if (name === 'attachments:remove') {
      return
    } else if (name === 'chat:stopStream' || name === 'subagents:stop') {
      stopped = [...stopped, String(args.childSessionId ?? args.sessionId)]
    } else if (!name.startsWith('typing:'))
      throw new Error(`Unexpected mutation: ${name}`)
    cache.clear()
    notify()
  },
} as unknown as ConvexReactClient

export const approvalFixtureControls = {
  stopTyping: () => {
    typingCount = 0
    cache.clear()
    notify()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot: () => JSON.stringify(mutations),
  resolve: () => resolvePending?.(),
  failNext: () => {
    failNext = true
  },
  release: () => {
    approvalsReady = true
    cache.clear()
    notify()
  },
}
