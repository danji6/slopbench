import { ChatSidebars } from '@/components/chat/chat-sidebars'
import { EmptyChat } from '@/components/chat/empty-chat'
import { NotificationProvider } from '@/components/chat/notifications/notification-provider'
import { ChatSearchProvider } from '@/components/chat/search'
import { LightboxProvider } from '@/components/ui/lightbox'
import '@/globals.css'
import { useChatShellState } from '@/hooks/chat/shell-state'
import { StreamStoreProvider } from '@/hooks/chat/stream'
import { applyTheme, exportSchemeCss } from '@/lib/theme'
import { generateThemeCss } from '@/lib/theme-worker'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexProvider } from 'convex/react'
import { Link } from 'wouter'

import { emptyChatClient } from './empty-chat-client'

const shellTheme = new URLSearchParams(location.search).has('shellTheme')
if (!shellTheme) {
  const sourceColor = '#70896b'
  const { css } = exportSchemeCss(sourceColor, true, 0)
  applyTheme({ sourceColor, mode: 'dark', contrast: 0, css })
}

function SessionThemeFixture() {
  const { activeSessionId } = useChatShellState(undefined)
  return (
    <>
      <output aria-label="Current session">{activeSessionId}</output>
      <Link href="?fixture=empty-chat&shellTheme&id=agent-1">
        Switch to themed agent
      </Link>
      <Link href="?fixture=empty-chat&shellTheme&id=agent-2">
        Switch to unthemed agent
      </Link>
      <button
        onClick={async () => {
          // Drain pending theme work before resolving the selected agent.
          await generateThemeCss('#274cad', false)
          window.dispatchEvent(new Event('resolve-agent-details'))
        }}
      >
        Resolve agent details
      </button>
    </>
  )
}

export function EmptyChatFixture() {
  const chat = (
    <LightboxProvider>
      <EmptyChat onFirstMessage={() => {}} />
    </LightboxProvider>
  )
  return (
    <ConvexProvider client={emptyChatClient}>
      <ConvexQueryCacheProvider>
        <StreamStoreProvider>
          <main className="bg-background text-foreground flex min-h-dvh w-full">
            {shellTheme ? (
              <SessionThemeFixture />
            ) : new URLSearchParams(location.search).has('withNavigation') ? (
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
