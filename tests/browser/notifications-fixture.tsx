import { NotificationInboxButton } from '@/components/chat/notifications/notification-inbox'
import { NotificationProvider } from '@/components/chat/notifications/notification-provider'
import { Toaster } from '@/components/ui/sonner'
import '@/globals.css'
import { ConvexProvider } from 'convex/react'
import { useSyncExternalStore } from 'react'

import {
  addApproval,
  addQuestion,
  expireRequests,
  notificationControls,
  notificationsClient,
} from './notifications-client'

/** Exercises notification controls with observable pending and failure states. */
export function NotificationsFixture() {
  const mutations = useSyncExternalStore(
    notificationControls.subscribe,
    notificationControls.snapshot,
  )
  return (
    <ConvexProvider client={notificationsClient}>
      <NotificationProvider>
        <main className="flex h-screen items-end gap-4 p-8">
          <button onClick={() => addApproval()}>Notify shell</button>
          <button onClick={() => addApproval(true)}>Notify file</button>
          <button onClick={notificationControls.settle}>
            Resolve elsewhere
          </button>
          <button onClick={notificationControls.failNext}>
            Fail next approval
          </button>
          <button onClick={notificationControls.release}>
            Complete response
          </button>
          <button onClick={addQuestion}>Notify question</button>
          <button onClick={expireRequests}>Expire requests</button>
          <button
            onClick={() => {
              for (let index = 0; index < 30; index++) addApproval()
            }}
          >
            Notify thirty
          </button>
          <button onClick={notificationControls.settleNewest}>
            Resolve newest
          </button>
          <NotificationInboxButton />
          <output aria-label="Approval mutations" className="sr-only">
            {mutations}
          </output>
        </main>
        <Toaster />
      </NotificationProvider>
    </ConvexProvider>
  )
}
