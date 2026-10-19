import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Requests from './model/notificationRequests'
import * as Notifications from './model/notifications'
import {
  notificationApprovalActionValidator,
  notificationStatusValidator,
} from './validators/notifications'

export const respondApproval = authMutation({
  args: {
    notificationId: v.id('notifications'),
    action: notificationApprovalActionValidator,
  },
  handler: Notifications.respondApproval,
})

export const list = authQuery({
  args: { status: notificationStatusValidator },
  handler: Notifications.list,
})

export const markRead = authMutation({
  args: { notificationId: v.id('notifications') },
  handler: Notifications.markRead,
})

export const markManyRead = authMutation({
  args: {
    notificationIds: v.array(v.id('notifications')),
  },
  handler: Notifications.markManyRead,
})

export const markAllRead = authMutation({
  args: {},
  handler: Notifications.markAllRead,
})

export const markSessionRead = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Notifications.markSessionRead,
})

export const discardSession = authMutation({
  args: { sessionId: v.id('sessions') },
  handler: Notifications.discardSession,
})

export const clearRead = authMutation({
  args: {},
  handler: Notifications.clearRead,
})

export const pendingPage = authQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    state: v.union(v.literal('pending'), v.literal('expired')),
  },
  handler: Requests.pendingPage,
})

export const summary = authQuery({
  args: {},
  handler: Requests.summary,
})

export const acknowledge = authMutation({
  args: { notificationId: v.id('notifications') },
  handler: Requests.acknowledge,
})
