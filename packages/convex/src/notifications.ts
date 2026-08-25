import { v } from 'convex/values'

import { authMutation, authQuery } from './functions'
import * as Notifications from './model/notifications'
import { notificationStatusValidator } from './validators/sub'

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
