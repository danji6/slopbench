import { ChatSidebars } from '@/components/chat/chat-sidebars'
import { EmptyChat } from '@/components/chat/empty-chat'
import { NotificationProvider } from '@/components/chat/notifications/notification-provider'
import { ChatSearchProvider } from '@/components/chat/search'
import '@/globals.css'
import { StreamStoreProvider } from '@/hooks/chat/stream'
import { applyTheme, exportSchemeCss } from '@/lib/theme'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'

import { emptyChatClient } from './empty-chat-client'

const sourceColor = '#70896b'
const { css } = exportSchemeCss(sourceColor, true, 0)
applyTheme({ sourceColor, mode: 'dark', contrast: 0, css })

export function EmptyChatFixture() {
  const chat = <EmptyChat onFirstMessage={() => {}} />
  return (
    <ConvexProvider client={emptyChatClient}>
      <ConvexQueryCacheProvider>
        <StreamStoreProvider>
          <main className="bg-background text-foreground flex min-h-dvh w-full">
            {new URLSearchParams(location.search).has('withNavigation') ? (
              <ChatSearchProvider>
                <NotificationProvider>
                  <ChatSidebars className="min-w-0 flex-1">{chat}</ChatSidebars>
                </NotificationProvider>
              </ChatSearchProvider>
            ) : (
              chat
            )}
          </main>
        </StreamStoreProvider>
      </ConvexQueryCacheProvider>
    </ConvexProvider>
  )
}
