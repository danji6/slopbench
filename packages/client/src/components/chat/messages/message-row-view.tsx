import {
  useActiveSession,
  useAttachmentIds,
  useChatMessage,
  useIsMessageStreaming,
  useSettings,
  useStreamInactivity,
  useUserProfile,
} from '@/hooks/chat'
import { useIsDarkMode } from '@/hooks/theme'
import { extractTextFromMessage, isEditableMessage } from '@/lib/chat'
import type { MessageRecord, PartMetadata } from '@/lib/chat'
import { type MessageRow, segmentGroupsFor } from '@/lib/chat/rows'
import { schemeToCssVars } from '@/lib/theme'
import { cn, formatDuration, isTouchDevice } from '@/lib/utils'
import type { Doc } from '@sb/convex/_generated/dataModel'
import { minRole } from '@sb/convex/lib/roles'
import { type UIMessage, isReasoningUIPart } from 'ai'
import { memo, useCallback, useMemo } from 'react'

import { ErrorBlock } from './error-block'
import { GrowOnly } from './grow-only'
import { MessageContext } from './message-context'
import { MessageContextMenu } from './message-context-menu'
import { MessageHeader } from './message-header'
import { useMessageHighlight } from './message-highlight-context'
import { MessageVersionSwitcher } from './message-version-switcher'
import { ReasoningHeader } from './reasoning-header'
import { RenderGroup } from './render-group'
import { WaitingIndicator } from './waiting-indicator'

export type MessageRowViewProps = {
  row: MessageRow
}

export const MessageRowView = memo(function MessageRowView({
  row,
}: MessageRowViewProps) {
  const { message, isLast, messageMeta, partMeta } = useChatMessage(
    row.messageId,
  )

  if (!message) return null

  return (
    <RowShell message={message} messageMeta={messageMeta} row={row}>
      {row.kind === 'header' &&
      (messageMeta?.senderSnapshot?.name || message.role === 'system') ? (
        <HeaderRow row={row} message={message} messageMeta={messageMeta} />
      ) : row.kind === 'group' ? (
        <GroupRow
          row={row}
          message={message}
          messageMeta={messageMeta}
          partMeta={partMeta}
        />
      ) : row.kind === 'footer' ? (
        <FooterRow
          message={message}
          messageMeta={messageMeta}
          partMeta={partMeta}
          isLast={isLast}
        />
      ) : null}
    </RowShell>
  )
})

type RowShellProps = {
  message: UIMessage
  messageMeta?: MessageRecord
  row: MessageRow
  children: React.ReactNode
}

function RowShell({ message, messageMeta, row, children }: RowShellProps) {
  const session = useActiveSession()
  const profile = useUserProfile()
  const canMutate = canMutateMessage(message, messageMeta, session, profile)
  const canEdit = useMemo(
    () => canMutate && isEditableMessage(message),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.parts.length, canMutate],
  )

  const content = useMemo(
    () => extractTextFromMessage(message),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.parts],
  )

  const messageCtx = useMemo(
    () => ({ id: message.id, canEdit, content }),
    [message.id, canEdit, content],
  )

  const settings = useSettings()
  const customCss =
    messageMeta?.senderSnapshot?.css ?? settings?.customCss ?? undefined
  const customCssClass = customCss
    ? `custom-css-${message.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    : undefined

  const isDark = useIsDarkMode()
  const theme = messageMeta?.senderSnapshot?.theme ?? settings?.theme ?? null
  const themeVars = useMemo(() => {
    if (!customCssClass || !theme) return ''
    return schemeToCssVars(isDark ? theme.dark : theme.light)
  }, [customCssClass, theme, isDark])

  const roleClass =
    message.role === 'user' ? 'usr' : message.role === 'system' ? 'sys' : 'ai'

  const inner = (
    <MessageContextMenu
      message={message}
      record={messageMeta}
      row={row}
      canMutate={canMutate}
    >
      <div
        data-slot="message-row"
        data-role={message.role}
        data-message-id={message.id}
        className={cn(
          'relative z-10 flex w-full min-w-0 flex-col items-start',
          // On mobile, long press will open the context menu instead
          isTouchDevice() && 'select-none [-webkit-touch-callout:none]',
          roleClass,
        )}
      >
        <GrowOnly growKey={messageMeta?.selectedVersion}>{children}</GrowOnly>
      </div>
    </MessageContextMenu>
  )

  return (
    <MessageContext.Provider value={messageCtx}>
      {customCssClass ? (
        <div data-slot="custom-css-wrapper" className={customCssClass}>
          <style data-slot="custom-css">{`
            @scope (.${customCssClass}) {
              ${themeVars ? `:scope { ${themeVars} }` : ''}
              ${customCss}
            }
          `}</style>
          {inner}
        </div>
      ) : (
        inner
      )}
    </MessageContext.Provider>
  )
}

function canMutateMessage(
  message: UIMessage,
  messageMeta: MessageRecord | undefined,
  session: Doc<'sessions'> | null,
  profile: Doc<'users'> | null,
): boolean {
  if (!session || !profile || isMessageProcessing(message)) return false

  const isSessionOwner = session.ownerId === profile._id
  if (session.settings?.disabled && !isSessionOwner) return false

  return (
    messageMeta?.sender.type !== 'user' ||
    messageMeta.sender.id === profile._id ||
    isSessionOwner ||
    minRole(profile.role, 'moderator')
  )
}

function isMessageProcessing(message: UIMessage): boolean {
  return (message as { status?: string }).status === 'processing'
}

type HeaderRowProps = {
  row: Extract<MessageRow, { kind: 'header' }>
  message: UIMessage
  messageMeta?: MessageRecord
}

function HeaderRow({ row, message, messageMeta }: HeaderRowProps) {
  const registerElement = useMessageHighlight()?.registerElement

  const highlightTarget = useMemo(
    () => ({ messageId: message.id, segmentIndex: null, groupIndex: null }),
    [message.id],
  )

  const highlightRef = useCallback(
    (element: HTMLDivElement | null) => {
      registerElement?.(highlightTarget, element)
    },
    [highlightTarget, registerElement],
  )

  const reasoning = useReasoningHeader(
    message,
    messageMeta,
    row.reasoningGroupIndex,
  )

  const sender = {
    name: messageMeta?.senderSnapshot?.name ?? 'System',
    avatarId: messageMeta?.senderSnapshot?.avatarId,
  }

  return (
    <div
      ref={highlightRef}
      data-slot="message-highlight-target"
      className="mb-4 w-fit max-w-full min-w-0"
    >
      {reasoning ? (
        <ReasoningHeader
          sender={sender}
          role={message.role}
          part={reasoning.part}
          messageId={message.id}
          segmentIndex={reasoning.segmentIndex}
          groupIndex={reasoning.groupIndex}
        />
      ) : (
        <MessageHeader sender={sender} role={message.role} />
      )}
    </div>
  )
}

function useReasoningHeader(
  message: UIMessage,
  messageMeta: MessageRecord | undefined,
  reasoningGroupIndex: number | undefined,
) {
  return useMemo(() => {
    if (reasoningGroupIndex === undefined) return null
    const slice = segmentGroupsFor(message, messageMeta)[0]
    const group = slice?.groups[reasoningGroupIndex]
    if (group?.type !== 'single' || !isReasoningUIPart(group.part)) return null
    return {
      part: group.part,
      segmentIndex: slice.segmentIndex,
      groupIndex: reasoningGroupIndex,
    }
  }, [message, messageMeta, reasoningGroupIndex])
}

type GroupRowProps = {
  row: Extract<MessageRow, { kind: 'group' }>
  message: UIMessage
  messageMeta?: MessageRecord
  partMeta?: PartMetadata
}

function GroupRow({ row, message, messageMeta, partMeta }: GroupRowProps) {
  const attachmentIds = useAttachmentIds(message)
  const slice = segmentGroupsFor(message, messageMeta).find(
    (candidate) => candidate.segmentIndex === row.segmentIndex,
  )
  const group = slice?.groups[row.groupIndex]
  const registerElement = useMessageHighlight()?.registerElement
  const highlightTarget = useMemo(
    () => ({
      messageId: message.id,
      segmentIndex: row.segmentIndex,
      groupIndex: row.groupIndex,
    }),
    [message.id, row.segmentIndex, row.groupIndex],
  )
  const highlightRef = useCallback(
    (element: HTMLDivElement | null) => {
      registerElement?.(highlightTarget, element)
    },
    [highlightTarget, registerElement],
  )

  if (!group) return null

  return (
    <div
      data-slot="message-group"
      className={cn('w-full max-w-full wrap-break-word')}
    >
      <div
        ref={highlightRef}
        data-slot="message-highlight-target"
        className="w-full min-w-0 has-data-full-width:w-full"
      >
        <RenderGroup
          message={message}
          type={messageMeta?.type}
          group={group}
          segmentIndex={row.segmentIndex}
          attachmentIds={attachmentIds}
          partMeta={partMeta}
        />
      </div>
    </div>
  )
}

type FooterRowProps = {
  message: UIMessage
  messageMeta?: MessageRecord
  partMeta?: PartMetadata
  isLast: boolean
}

function FooterRow({ message, messageMeta, partMeta, isLast }: FooterRowProps) {
  const isStreaming = useIsMessageStreaming(message.id)
  const isInactive = useStreamInactivity(message)

  const totalDurationMs = useMemo(() => {
    const duration = partMeta?.duration
    return duration && duration > 0 ? duration : undefined
  }, [partMeta])

  const showDuration = totalDurationMs !== undefined && !isStreaming

  const error = messageMeta?.metadata?.error

  const versionCount = messageMeta?.versionCount ?? 1
  const selectedVersion = messageMeta?.selectedVersion ?? 1
  const showSwitcher = versionCount > 1

  if (!error && !isInactive && !showDuration && !showSwitcher) {
    return null
  }

  return (
    <div
      data-slow="message-footer"
      className={cn('flex w-full flex-col', !isLast && 'pb-4')}
    >
      {error && (
        <div className="px-4">
          <ErrorBlock messageId={message.id} error={error} />
        </div>
      )}
      {isInactive && (
        <WaitingIndicator visible className="static w-auto gap-2" />
      )}
      {(showSwitcher || showDuration) && (
        <div className="flex items-center gap-3 px-2 pt-4">
          {showSwitcher && (
            <MessageVersionSwitcher
              messageId={message.id}
              selectedVersion={selectedVersion}
              versionCount={versionCount}
              disabled={isStreaming}
            />
          )}
          {showDuration && (
            <span className="text-muted-foreground/80 text-sm tabular-nums">
              {formatDuration(totalDurationMs)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
