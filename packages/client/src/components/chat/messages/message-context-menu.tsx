import { ConfirmDialog, ContextMenu } from '@/components/ui'
import type { ContextMenuPoint } from '@/components/ui'
import {
  useDeleteMessage,
  useDeleteMessageParts,
  useDeleteMessagesFrom,
  useHasNewerMessages,
  useRetryMessage,
} from '@/hooks/chat'
import { extractTextFromMessage, isEditableMessage } from '@/lib/chat'
import type { MessageRecord } from '@/lib/chat'
import {
  type PartAddress,
  fromAddressForGroup,
  groupPartAddresses,
} from '@/lib/chat/parts'
import {
  type MessageRow,
  type SegmentGroups,
  segmentGroupsFor,
} from '@/lib/chat/rows'
import {
  type UIMessage,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
} from 'ai'
import { CopyIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { prefetchRichTextEditor } from './editor/editable-text'
import { useMessageEdit } from './editor/message-edit-context'
import {
  type MessageEditSelectionSnapshot,
  captureMessageEditSelection,
  messageEditSelectionOptions,
} from './message-edit-selection'
import { useMessageHighlight } from './message-highlight-context'

export type MessageContextMenuProps = {
  message: UIMessage
  record?: MessageRecord
  row: MessageRow
  canMutate: boolean
  children: React.ReactElement
}

type Confirm = 'part' | 'message' | null

/** Which group the menu acts on, or null for message-wide. */
type GroupScope = { segmentIndex: number; groupIndex: number }

type TextBlock = {
  text: string
  address: PartAddress
}

type MenuState = {
  edit: {
    block?: TextBlock
    messageText?: string
    submenu: boolean
  }
  copy: {
    blockText?: string
    messageText?: string
    submenu: boolean
  }
  delete: {
    blockAddresses: PartAddress[]
    blockFrom?: PartAddress
    message: boolean
    submenu: boolean
  }
  retry: boolean
  hasTopItems: boolean
}

function copy(text: string) {
  navigator.clipboard.writeText(text).catch(() => {})
}

export function MessageContextMenu({
  message,
  record,
  row,
  canMutate,
  children,
}: MessageContextMenuProps) {
  const editCtx = useMessageEdit()
  const deleteMessage = useDeleteMessage()
  const deleteMessageParts = useDeleteMessageParts()
  const deleteMessagesFrom = useDeleteMessagesFrom()
  const hasNewer = useHasNewerMessages(message.id)
  const retryMessage = useRetryMessage()
  const highlight = useMessageHighlight()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const isEditing = editCtx?.editingMessageId === message.id

  const editSelectionRef = useRef<MessageEditSelectionSnapshot | null>(null)
  const ownsHighlightRef = useRef(false)

  const slices = segmentGroupsFor(message, record)
  const baseScope: GroupScope | null =
    row.kind === 'group'
      ? { segmentIndex: row.segmentIndex, groupIndex: row.groupIndex }
      : null
  const [scope, setScope] = useState<GroupScope | null>(baseScope)
  const scopeRef = useRef<GroupScope | null>(baseScope)

  const menu = useMemo(
    () => getMessageContextMenuState(message, slices, record, scope, canMutate),
    [message, slices, record, scope, canMutate],
  )

  // Resolve which block the menu acts on from where it was opened
  function handleOpen({ x, y }: ContextMenuPoint) {
    // Preload the editor in case the user intends to edit the message
    if (canMutate) prefetchRichTextEditor()
    editSelectionRef.current = captureMessageEditSelection(message.id, x, y)
    const next = resolveScope(row, slices, x, y)
    scopeRef.current = next
    setScope(next)
  }

  // Highlight just the targeted block when one is scoped within a multi-block
  // message, otherwise highlight the whole message
  function handleOpenChange(open: boolean) {
    if (!highlight) return
    if (open) {
      ownsHighlightRef.current = true
      const multiGroup = countGroups(slices) > 1
      const blockScoped = scopeRef.current !== null && multiGroup
      highlight.setTarget({
        messageId: message.id,
        segmentIndex: blockScoped ? scopeRef.current!.segmentIndex : null,
        groupIndex: blockScoped ? scopeRef.current!.groupIndex : null,
      })
    } else if (ownsHighlightRef.current) {
      ownsHighlightRef.current = false
      highlight.setTarget(null)
    }
  }

  function startEditBlock() {
    const block = menu.edit.block
    if (!block) return
    editCtx?.startEditing(message.id, block.text, {
      address: block.address,
      ...messageEditSelectionOptions(editSelectionRef.current, 'block'),
    })
  }

  function startEditMessage() {
    const { messageText } = menu.edit
    if (!messageText) return
    editCtx?.startEditing(message.id, messageText, {
      ...messageEditSelectionOptions(editSelectionRef.current, 'message'),
    })
  }

  const ownsReasoning =
    row.kind === 'header' && row.reasoningGroupIndex !== undefined

  if (isEditing) return children
  if (
    !menu.hasTopItems &&
    !menu.delete.message &&
    !menu.retry &&
    !ownsReasoning
  ) {
    return children
  }

  return (
    <>
      <ContextMenu onOpen={handleOpen} onOpenChange={handleOpenChange}>
        <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
        <ContextMenu.Content>
          {menu.retry && (
            <>
              <ContextMenu.Item onSelect={() => retryMessage(message.id)}>
                <RotateCcwIcon />
                Retry
              </ContextMenu.Item>
              {(menu.hasTopItems || menu.delete.message) && (
                <ContextMenu.Separator />
              )}
            </>
          )}
          <EditMenu
            edit={menu.edit}
            onEditBlock={startEditBlock}
            onEditMessage={startEditMessage}
          />
          <CopyMenu copy={menu.copy} />
          {menu.hasTopItems && menu.delete.message && <ContextMenu.Separator />}
          {menu.delete.message && (
            <DeleteMenu
              deleteState={menu.delete}
              onDeleteBlock={() => setConfirm('part')}
              onDeleteMessage={() => setConfirm('message')}
            />
          )}
        </ContextMenu.Content>
      </ContextMenu>

      <ConfirmDialog
        open={confirm === 'part'}
        onOpenChange={(open) => !open && setConfirm(null)}
        variant="destructive"
        title="Delete this block?"
        description={
          menu.delete.blockFrom
            ? '"Delete all" also removes every later block in this message. This action cannot be undone.'
            : 'This action cannot be undone.'
        }
        confirmText="Delete"
        extraAction={
          menu.delete.blockFrom
            ? {
                text: 'Delete all',
                variant: 'destructive',
                onConfirm: () =>
                  deleteMessageParts(message.id, [], menu.delete.blockFrom),
              }
            : undefined
        }
        onConfirm={() =>
          deleteMessageParts(message.id, menu.delete.blockAddresses)
        }
      />
      <ConfirmDialog
        open={confirm === 'message'}
        onOpenChange={(open) => !open && setConfirm(null)}
        variant="destructive"
        title="Delete this message?"
        description={
          hasNewer
            ? '"Delete all" also removes every later message in this session. This action cannot be undone.'
            : 'This action cannot be undone.'
        }
        confirmText="Delete"
        extraAction={
          hasNewer
            ? {
                text: 'Delete all',
                variant: 'destructive',
                onConfirm: () => deleteMessagesFrom(message.id),
              }
            : undefined
        }
        onConfirm={() => deleteMessage(message.id)}
      />
    </>
  )
}

type EditMenuProps = {
  edit: MenuState['edit']
  onEditBlock: () => void
  onEditMessage: () => void
}

function EditMenu({ edit, onEditBlock, onEditMessage }: EditMenuProps) {
  if (edit.submenu) {
    return (
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger>
          <PencilIcon />
          Edit
        </ContextMenu.SubTrigger>
        <ContextMenu.SubContent>
          {edit.block && (
            <ContextMenu.Item onSelect={onEditBlock}>
              <PencilIcon />
              Edit Block
            </ContextMenu.Item>
          )}
          {edit.messageText && (
            <ContextMenu.Item onSelect={onEditMessage}>
              <PencilIcon />
              Edit Message
            </ContextMenu.Item>
          )}
        </ContextMenu.SubContent>
      </ContextMenu.Sub>
    )
  }

  if (!edit.messageText) return null

  return (
    <ContextMenu.Item onSelect={onEditMessage}>
      <PencilIcon />
      Edit Message
    </ContextMenu.Item>
  )
}

type CopyMenuProps = {
  copy: MenuState['copy']
}

function CopyMenu({ copy: copyState }: CopyMenuProps) {
  const { blockText, messageText } = copyState

  if (copyState.submenu && blockText !== undefined && messageText) {
    return (
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger>
          <CopyIcon />
          Copy
        </ContextMenu.SubTrigger>
        <ContextMenu.SubContent>
          <ContextMenu.Item onSelect={() => copy(blockText)}>
            <CopyIcon />
            Copy Block
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => copy(messageText)}>
            <CopyIcon />
            Copy Message
          </ContextMenu.Item>
        </ContextMenu.SubContent>
      </ContextMenu.Sub>
    )
  }

  if (blockText !== undefined) {
    return (
      <ContextMenu.Item onSelect={() => copy(blockText)}>
        <CopyIcon />
        Copy Block
      </ContextMenu.Item>
    )
  }

  if (!messageText) return null

  return (
    <ContextMenu.Item onSelect={() => copy(messageText)}>
      <CopyIcon />
      Copy Message
    </ContextMenu.Item>
  )
}

type DeleteMenuProps = {
  deleteState: MenuState['delete']
  onDeleteBlock: () => void
  onDeleteMessage: () => void
}

function DeleteMenu({
  deleteState,
  onDeleteBlock,
  onDeleteMessage,
}: DeleteMenuProps) {
  if (deleteState.submenu) {
    return (
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger>
          <Trash2Icon />
          Delete
        </ContextMenu.SubTrigger>
        <ContextMenu.SubContent>
          <ContextMenu.Item variant="destructive" onSelect={onDeleteBlock}>
            <Trash2Icon />
            Delete Block
          </ContextMenu.Item>
          <ContextMenu.Item variant="destructive" onSelect={onDeleteMessage}>
            <Trash2Icon />
            Delete Message
          </ContextMenu.Item>
        </ContextMenu.SubContent>
      </ContextMenu.Sub>
    )
  }

  return (
    <ContextMenu.Item variant="destructive" onSelect={onDeleteMessage}>
      <Trash2Icon />
      Delete Message
    </ContextMenu.Item>
  )
}

/** Which group the menu acts on for a given right-click, or null for message-wide. */
function resolveScope(
  row: MessageRow,
  slices: SegmentGroups[],
  x: number,
  y: number,
): GroupScope | null {
  if (row.kind === 'group') {
    return { segmentIndex: row.segmentIndex, groupIndex: row.groupIndex }
  }
  if (row.kind === 'header' && row.reasoningGroupIndex !== undefined) {
    const element = document.elementFromPoint(x, y)
    if (element?.closest('[data-slot="reasoning-highlight"]')) {
      return {
        segmentIndex: slices[0]?.segmentIndex ?? 0,
        groupIndex: row.reasoningGroupIndex,
      }
    }
  }
  return null
}

function countGroups(slices: SegmentGroups[]): number {
  return slices.reduce((sum, slice) => sum + slice.groups.length, 0)
}

function isLastGroup(slices: SegmentGroups[], scope: GroupScope): boolean {
  const last = slices[slices.length - 1]
  return (
    last !== undefined &&
    last.segmentIndex === scope.segmentIndex &&
    scope.groupIndex === last.groups.length - 1
  )
}

function getMessageContextMenuState(
  message: UIMessage,
  slices: SegmentGroups[],
  record: MessageRecord | undefined,
  scope: GroupScope | null,
  canMutate: boolean,
): MenuState {
  const messageText = extractTextFromMessage(message) || undefined

  const slice = scope
    ? slices.find((candidate) => candidate.segmentIndex === scope.segmentIndex)
    : undefined

  const group = scope && slice ? slice.groups[scope.groupIndex] : undefined
  const blockPart = group?.type === 'single' ? group.part : undefined
  const blockText = getCopyableBlockText(blockPart)
  const hasBlockLevelStructure = hasBlockLevelParts(message.parts)
  const multiGroup = countGroups(slices) > 1
  const canCopyBlock = multiGroup && blockText !== undefined

  const blockAddresses =
    scope && slice && group
      ? groupPartAddresses(scope.segmentIndex, slice.parts, group)
      : []

  const blockFrom =
    scope && group && (!isLastGroup(slices, scope) || record?.hasNewerSegments)
      ? fromAddressForGroup(scope.segmentIndex, group)
      : undefined

  const editBlock =
    hasBlockLevelStructure &&
    scope &&
    group?.type === 'single' &&
    blockPart &&
    isTextUIPart(blockPart)
      ? {
          text: blockPart.text,
          address: { segmentIndex: scope.segmentIndex, partIndex: group.index },
        }
      : undefined

  const availableEditBlock = canMutate ? editBlock : undefined
  const editMessageText = messageText && isEditableMessage(message) ? messageText : undefined // prettier-ignore
  const availableEditMessageText = canMutate ? editMessageText : undefined

  const isReasoningBlock = Boolean(blockPart && isReasoningUIPart(blockPart))

  return {
    edit: {
      block: availableEditBlock,
      messageText: availableEditMessageText,
      submenu:
        multiGroup &&
        hasBlockLevelStructure &&
        Boolean(availableEditBlock || availableEditMessageText),
    },
    copy: {
      blockText: canCopyBlock ? blockText : undefined,
      messageText,
      submenu: canCopyBlock && Boolean(messageText),
    },
    delete: {
      blockAddresses: canMutate ? blockAddresses : [],
      blockFrom: canMutate ? blockFrom : undefined,
      message: canMutate,
      submenu:
        canMutate &&
        multiGroup &&
        (hasBlockLevelStructure || isReasoningBlock) &&
        blockAddresses.length > 0,
    },
    retry: canMutate && message.role === 'assistant',
    hasTopItems: Boolean(
      availableEditBlock ||
      availableEditMessageText ||
      canCopyBlock ||
      messageText,
    ),
  }
}

function hasBlockLevelParts(parts: UIMessage['parts']): boolean {
  return parts.some(isStructuralPart) || parts.filter(isTextUIPart).length > 1
}

function isStructuralPart(part: UIMessage['parts'][number]): boolean {
  return isFileUIPart(part) || isToolUIPart(part)
}

function getCopyableBlockText(
  part: UIMessage['parts'][number] | undefined,
): string | undefined {
  return part && (isTextUIPart(part) || isReasoningUIPart(part))
    ? part.text
    : undefined
}
