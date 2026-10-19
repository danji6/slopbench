import type { NotificationItem } from '@/lib/chat/notification-ui'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'

let items: NotificationItem[] = []
let failNext = false
let release: (() => void) | undefined
let log = '[]'
const mutations: object[] = []
const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()

function update() {
  cache.clear()
  log = JSON.stringify(mutations)
  for (const listener of listeners) listener()
}

export function addApproval(file = false) {
  items = [
    ...items,
    {
      _id: `notification_${items.length}`,
      _creationTime: Date.now(),
      recipientId: 'user',
      sessionId: 'approval-chat',
      sessionTitle: 'Lifecycle regression tests',
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
  settle: () => {
    items = items.map((item) => ({
      ...item,
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
          cache.set(
            key,
            name === 'notifications:list'
              ? items.filter((item) => item.status === args.status)
              : null,
          )
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
        item._id === args.notificationId ? { ...item, status: 'read' } : item,
      )
    }
    update()
  },
}

export const notificationsClient = client as unknown as ConvexReactClient
