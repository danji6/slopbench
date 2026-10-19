import type { NotificationItem } from '@/lib/chat/notification-ui'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

let items: NotificationItem[] = JSON.parse(
  localStorage.getItem('fixture:notifications') ?? '[]',
)
let desktopNotifications = localStorage.getItem('fixture:desktop') !== 'false'
let failNext = false
let release: (() => void) | undefined
let log = '[]'
const mutations: object[] = []
const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()

function update() {
  localStorage.setItem('fixture:notifications', JSON.stringify(items))
  cache.clear()
  log = JSON.stringify(mutations)
  for (const listener of listeners) listener()
}

export function addApproval(file = false, sessionId = 'approval-chat') {
  items = [
    ...items,
    {
      _id: `notification_${items.length}`,
      _creationTime: Date.now(),
      recipientId: 'user',
      sessionId,
      sessionTitle:
        sessionId === 'approval-chat'
          ? 'Lifecycle regression tests'
          : 'Other session',
      actorName: 'Ada',
      kind: 'approval_required',
      status: 'unread',
      preview: file
        ? 'write_file: src/server.ts'
        : 'Start the local sidecar test server',
      approval: {
        streamId: 'stream',
        messageId: 'message',
        contentId: 'content',
        toolCallId: `call_${items.length}`,
        approvalId: `approval_${items.length}`,
      },
      requestState: 'pending',
      attention: true,
      request: {
        streamId: 'stream',
        messageId: 'message',
        contentId: 'content',
        toolCallId: `call_${items.length}`,
      },
      approvalPending: true,
      approvalActions: [
        { action: 'allow', label: 'Allow' },
        {
          action: 'allow-session',
          label: 'Allow for this session',
          description: file
            ? 'Allow edits for this session'
            : 'Allow for this session: `bun run`',
        },
        { action: 'deny', label: 'Deny' },
      ],
    } as NotificationItem,
  ]
  update()
}

export const notificationControls = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  snapshot: () => log,
  failNext: () => {
    failNext = true
  },
  release: () => release?.(),
  settleNewest: () => {
    const newest = [...items]
      .reverse()
      .find((item) => item.requestState === 'pending')
    items = items.map((item) =>
      item === newest
        ? {
            ...item,
            requestState: 'handled',
            attention: false,
            status: 'read',
            approvalPending: false,
            approvalActions: [],
          }
        : item,
    )
    update()
  },
  settle: () => {
    items = items.map((item) => ({
      ...item,
      requestState: 'handled',
      attention: false,
      status: 'read',
      approvalPending: false,
      approvalActions: [],
    }))
    update()
  },
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
        if (!cache.has(key)) {
          cache.set(key, queryResult(name, args))
        }
        return cache.get(key)
      },
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  async mutation(
    reference: FunctionReference<'mutation'>,
    args: Record<string, unknown>,
  ) {
    const name = getFunctionName(reference)
    if (name === 'notifications:respondApproval') {
      mutations.push(args)
      update()
      await new Promise<void>((resolve) => {
        release = resolve
      })
      if (failNext) {
        failNext = false
        throw new Error('Approval failed; try again')
      }
      items = items.map((item) =>
        item._id === args.notificationId
          ? {
              ...item,
              status: 'read',
              requestState: 'handled',
              attention: false,
              readAt: Date.now(),
              approvalPending: false,
              approvalActions: [],
            }
          : item,
      )
      update()
      return 'applied'
    }
    if (name === 'notifications:markRead') {
      items = items.map((item) =>
        item._id === args.notificationId && !item.attention
          ? { ...item, status: 'read' }
          : item,
      )
    }
    if (name === 'settings:update') {
      desktopNotifications = (args.patch as { desktopNotifications: boolean })
        .desktopNotifications
      localStorage.setItem('fixture:desktop', String(desktopNotifications))
    }
    if (
      name === 'notifications:markAllRead' ||
      name === 'notifications:markSessionRead'
    ) {
      items = items.map((item) =>
        item.attention ||
        (name === 'notifications:markSessionRead' &&
          item.sessionId !== args.sessionId)
          ? item
          : { ...item, status: 'read' },
      )
    }
    if (name === 'notifications:discardSession')
      items = items.filter(
        (item) =>
          item.attention ||
          item.status !== 'unread' ||
          item.sessionId !== args.sessionId,
      )
    if (name === 'notifications:acknowledge') {
      items = items.map((item) =>
        item._id === args.notificationId && item.requestState === 'expired'
          ? { ...item, attention: false, status: 'read' }
          : item,
      )
    }
    if (name === 'notifications:clearRead')
      items = items.filter((item) => item.status !== 'read')
    update()
  },
}

export const notificationsClient = client as unknown as ConvexReactClient

function queryResult(name: string, args: Record<string, unknown>) {
  if (name === 'settings:get') return { desktopNotifications }
  if (name === 'notifications:list')
    return items.filter(
      (item) => !item.attention && item.status === args.status,
    )
  const pending = items.filter((item) => item.requestState === 'pending')
  if (name === 'notifications:summary')
    return {
      unreadCount: items.filter(
        (item) => item.status === 'unread' || item.attention,
      ).length,
      pendingCount: pending.length,
      activeIds: items
        .filter(
          (item) =>
            item.requestState === 'pending' ||
            (!item.attention && item.status === 'unread'),
        )
        .map((item) => item._id),
      recent: [...pending].reverse(),
    }
  if (name === 'notifications:pendingPage') {
    const { cursor, numItems } = args.paginationOpts as {
      cursor: string | null
      numItems: number
    }
    const start = Number(cursor ?? 0)
    const rows = items.filter(
      (item) => item.attention && item.requestState === args.state,
    )
    return {
      page: rows.slice(start, start + numItems),
      isDone: start + numItems >= rows.length,
      continueCursor: String(start + numItems),
    }
  }
  return null
}

window.addEventListener('storage', (event) => {
  if (event.key === 'fixture:desktop') {
    desktopNotifications = event.newValue !== 'false'
    cache.clear()
    for (const listener of listeners) listener()
  }
  if (event.key === 'fixture:notifications') {
    items = JSON.parse(event.newValue ?? '[]')
    cache.clear()
    for (const listener of listeners) listener()
  }
})

export function addQuestion() {
  addApproval()
  items = items.map((item, index) =>
    index === items.length - 1
      ? {
          ...item,
          kind: 'input_required',
          preview: 'Which deployment target?',
          approval: undefined,
          approvalPending: false,
          approvalActions: [],
        }
      : item,
  )
  update()
}

export function expireRequests() {
  items = items.map((item) =>
    item.requestState === 'pending'
      ? {
          ...item,
          requestState: 'expired',
          approvalPending: false,
          approvalActions: [],
        }
      : item,
  )
  update()
}

export function addActivity() {
  addApproval()
  items = items.map((item, index) =>
    index === items.length - 1
      ? {
          ...item,
          kind: 'turn_completed',
          preview: 'Finished the regression tests',
          approval: undefined,
          approvalPending: false,
          approvalActions: [],
          request: undefined,
          requestState: undefined,
          attention: false,
        }
      : item,
  )
  update()
}
