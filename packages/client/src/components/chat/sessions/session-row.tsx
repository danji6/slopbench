import {
  ConfirmDialog,
  ContextMenu,
  RippleButton,
  Tooltip,
  useOptionalSidebar,
} from '@/components/ui'
import {
  useSession,
  useSessionIsActive,
  useSessionIsStreaming,
} from '@/hooks/chat'
import { formatRelativeTime } from '@/lib'
import type { SessionParticipant } from '@/lib/chat'
import { triggerJsonDownload } from '@/lib/chat/io'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction, useMutation } from 'convex/react'
import {
  BotIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  TrashIcon,
  UserIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'wouter'

import { SessionAvatar } from './session-avatar'

interface SessionRowProps {
  id: string
  rename: (id: string) => void
}

export function SessionRow({ id, rename }: SessionRowProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const item = useSession(id)
  const isActive = useSessionIsActive(id)
  const isStreaming = useSessionIsStreaming(id)
  const [, navigate] = useLocation()
  const sidebar = useOptionalSidebar()
  const removeSession = useMutation(api.sessions.remove)
  const createSession = useMutation(api.sessions.create)
  const setHidden = useMutation(api.sessions.setHidden)
  const exportSession = useAction(api.actions.sessions.exportOne)

  if (!item) return null

  function handleSelect() {
    navigate(`/?id=${id}`, { replace: true })
    sidebar?.close()
  }

  async function handleDelete() {
    if (isActive) navigate('/', { replace: true })
    await removeSession({ sessionId: id as Id<'sessions'> })
  }

  async function handleDuplicate() {
    if (!item) return
    const { sessionId } = await createSession({
      title: item.title ? `${item.title} (copy)` : undefined,
      activeAgentId: item.activeAgentId,
    })
    navigate(`/?id=${sessionId}`, { replace: true })
  }

  async function handleToggleHidden() {
    await setHidden({
      sessionId: id as Id<'sessions'>,
      hidden: !item?.hidden,
    })
  }

  async function handleExport() {
    if (!item) return
    try {
      const archive = await exportSession({ sessionId: id as Id<'sessions'> })
      triggerJsonDownload(archive.session.title, archive)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not export session',
      )
    }
  }

  const timestamp = item.lastMessageAt ?? item._creationTime
  const displayTitle = item.title || item.firstMessagePreview || 'New chat'
  const showPreview = Boolean(item.title) && Boolean(item.lastMessagePreview)

  return (
    <>
      <ContextMenu>
        <ContextMenu.Trigger className="w-full">
          <Tooltip>
            <Tooltip.Trigger
              render={
                <RippleButton
                  variant="stealth"
                  className={cn(
                    'h-auto w-full flex-col items-stretch gap-0.5 rounded-md px-2 py-2 select-none',
                    isActive && 'bg-m3-surface-container-high',
                  )}
                  onClick={handleSelect}
                >
                  <span className="flex w-full items-center gap-1.5">
                    {isStreaming && (
                      <span
                        aria-label="Streaming"
                        className="bg-primary size-2 shrink-0 animate-pulse rounded-full"
                      />
                    )}
                    {item.hidden && (
                      <EyeOffIcon className="text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-start">
                      {displayTitle}
                    </span>
                  </span>

                  <span className="text-muted-foreground flex w-full items-center gap-1.5 text-xs">
                    {item.participants.length > 0 && (
                      <ParticipantStack participants={item.participants} />
                    )}
                    <span className="shrink-0">
                      {formatRelativeTime(timestamp)}
                    </span>
                    {showPreview && (
                      <>
                        <span className="shrink-0">•</span>
                        <span className="min-w-0 flex-1 truncate text-start font-normal">
                          {item.lastMessagePreview}
                        </span>
                      </>
                    )}
                  </span>
                </RippleButton>
              }
            />
            <Tooltip.Content className="max-w-48 wrap-break-word">
              {displayTitle}
            </Tooltip.Content>
          </Tooltip>
        </ContextMenu.Trigger>

        <ContextMenu.Content className="min-w-32">
          <ContextMenu.Item onSelect={() => rename(id)}>
            <PencilIcon />
            Rename
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={handleDuplicate}>
            <CopyIcon />
            Duplicate
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={handleExport}>
            <DownloadIcon />
            Export
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={handleToggleHidden}>
            {item.hidden ? <EyeIcon /> : <EyeOffIcon />}
            {item.hidden ? 'Unhide' : 'Hide'}
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item
            variant="destructive"
            onSelect={() => setConfirmDeleteOpen(true)}
          >
            <TrashIcon />
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        variant="destructive"
        title="Delete session?"
        description="This session and its messages will be deleted."
        confirmText="Delete"
        onConfirm={handleDelete}
      />
    </>
  )
}

function ParticipantStack({
  participants,
}: {
  participants: SessionParticipant[]
}) {
  const shown = participants.slice(0, 3)
  const extra = participants.length - shown.length

  return (
    <span className="flex shrink-0 items-center -space-x-1.5">
      {shown.map((participant) => (
        <SessionAvatar
          key={participant.id}
          avatarId={participant.avatarId}
          size="xs"
          className="ring-m3-surface ring-2"
          fallbackIcon={
            participant.kind === 'agent' ? <BotIcon /> : <UserIcon />
          }
        />
      ))}
      {extra > 0 && <span className="pl-2.5">+{extra}</span>}
    </span>
  )
}
