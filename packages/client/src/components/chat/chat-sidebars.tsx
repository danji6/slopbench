import {
  BouncyButton,
  Pill,
  QuickTooltip,
  Sidebar,
  useSidebar,
} from '@/components/ui'
import { SessionStoreProvider } from '@/hooks/chat'
import {
  type SidebarSide,
  getSidebarState,
  setSidebarState,
} from '@/lib/ui-settings'
import { cn } from '@/lib/utils'
import { PanelLeftIcon, PanelRightIcon, SearchIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import type { SidebarShellProps } from '../ui/sidebar'
import { ManageAgentsButton } from './entities/agent/agent-settings'
import { ChatSettingsButton } from './entities/user/user-settings'
import { SearchHistoryButton, useChatSearch } from './search'
import {
  AgentsStrip,
  JoinSessionButton,
  NewSessionButton,
  SessionListView,
  SessionPanel,
} from './sessions'

type ChatSidebarProps = SidebarShellProps

export function ChatSidebars({
  children,
  className,
  ...props
}: ChatSidebarProps) {
  return (
    <Sidebar.Shell className={className} {...props}>
      <LeftSidebar />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      <RightSidebar />
    </Sidebar.Shell>
  )
}

function ChatSidebar({
  side,
  children,
}: {
  side: SidebarSide
  children: React.ReactNode
}) {
  const state = getSidebarState(side)

  return (
    <Sidebar
      side={side}
      width={80}
      defaultPinned={state.pinned}
      onPinnedChange={(pinned) => setSidebarState(side, { pinned })}
      defaultCollapsed={state.collapsed ?? true}
      onCollapsedChange={(collapsed) => setSidebarState(side, { collapsed })}
    >
      <MobileToggle side={side} />
      {children}
    </Sidebar>
  )
}

function LeftSidebar() {
  const [, navigate] = useLocation()
  const newSession = () => navigate('/', { replace: true })

  return (
    <ChatSidebar side="left">
      <Sidebar.Panel>
        <Sidebar.Collapsed>
          <Sidebar.Header className="items-center">
            <QuickTooltip text="Expand" side="right">
              <Sidebar.Toggle />
            </QuickTooltip>
            <QuickTooltip text="New Session" side="right">
              <NewSessionButton collapsed onClick={newSession} />
            </QuickTooltip>
            <QuickTooltip text="Join Session" side="right">
              <JoinSessionButton collapsed />
            </QuickTooltip>
          </Sidebar.Header>
          <Sidebar.Footer className="items-center">
            <QuickTooltip text="Manage Agents" side="right">
              <ManageAgentsButton collapsed />
            </QuickTooltip>
            <QuickTooltip text="Settings" side="right">
              <ChatSettingsButton collapsed />
            </QuickTooltip>
          </Sidebar.Footer>
        </Sidebar.Collapsed>
        <Sidebar.Expanded>
          <Sidebar.Header>
            <Sidebar.Toggle />
            <div className="grid grid-cols-[1fr_--spacing(18)] gap-2">
              <NewSessionButton onClick={newSession} />
              <JoinSessionButton />
            </div>
          </Sidebar.Header>
          <Sidebar.Content>
            <SessionStoreProvider>
              <SessionListView />
            </SessionStoreProvider>
          </Sidebar.Content>
          <Sidebar.Footer>
            <ManageAgentsButton />
            <ChatSettingsButton />
          </Sidebar.Footer>
        </Sidebar.Expanded>
      </Sidebar.Panel>
    </ChatSidebar>
  )
}

function RightSidebar() {
  const { available: canSearch } = useChatSearch()

  return (
    <ChatSidebar side="right">
      <Sidebar.Panel>
        <Sidebar.Collapsed>
          <Sidebar.Header className="items-center">
            <QuickTooltip text="Expand" side="left">
              <Sidebar.Toggle />
            </QuickTooltip>
          </Sidebar.Header>
          <Sidebar.Content className="items-center">
            <AgentsStrip />
          </Sidebar.Content>
          {canSearch && (
            <Sidebar.Footer className="items-center">
              <QuickTooltip text="Search" side="left">
                <SearchHistoryButton collapsed />
              </QuickTooltip>
            </Sidebar.Footer>
          )}
        </Sidebar.Collapsed>
        <Sidebar.Expanded>
          <Sidebar.Header>
            <Sidebar.Toggle />
          </Sidebar.Header>
          <Sidebar.Content>
            <SessionPanel />
          </Sidebar.Content>
        </Sidebar.Expanded>
      </Sidebar.Panel>
    </ChatSidebar>
  )
}

function MobileToggle({ side = 'left' }: { side?: 'left' | 'right' }) {
  const { open, isOpen, isMobile } = useSidebar()
  const { open: openSearch, available: canSearch } = useChatSearch()

  if (!isMobile || isOpen) return null

  return (
    <Pill
      data-slot="mobile-nav-toggle"
      className={cn('fixed top-2 z-50', side === 'left' ? 'left-2' : 'right-2')}
    >
      {side === 'right' && canSearch && (
        <BouncyButton
          onClick={openSearch}
          variant="ghost"
          size="icon"
          className="relative h-10 min-w-15"
        >
          <SearchIcon />
        </BouncyButton>
      )}
      <BouncyButton
        onClick={open}
        variant="ghost"
        size="icon"
        className="relative h-10 min-w-15"
      >
        {side === 'left' ? <PanelLeftIcon /> : <PanelRightIcon />}
      </BouncyButton>
    </Pill>
  )
}
