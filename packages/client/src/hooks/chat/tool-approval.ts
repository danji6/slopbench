import type { ToolApprovalPickerProps } from '@/components/chat/workspace/tool-approval-picker'
import {
  useActiveSession,
  useActiveSessionState,
  useChatMessage,
  useIsAdmin,
  useStreamAwaitingApproval,
  useStreamProcessingMessageId,
} from '@/hooks/chat'
import { useSelectedApprovalAction } from '@/hooks/chat/tool-approval-interaction'
import { useApprovalKeybinds } from '@/hooks/chat/tool-approval-interaction'
import type { RememberScope } from '@/lib/chat'
import { optimisticallyRespondApproval } from '@/lib/chat/approval-optimistic'
import { useComposerDraft } from '@/lib/chat/composer-draft-store'
import { type ApprovalAction } from '@/lib/chat/tool-approval-policy'
import { PLAN_APPROVALS } from '@/lib/chat/tool-approval-policy'
import { buildApprovalActions } from '@/lib/chat/tool-approval-policy'
import { isApprovalRequested } from '@/lib/chat/tool-approval-policy'
import { getDescription } from '@/lib/chat/tool-approval-policy'
import { alwaysLabel } from '@/lib/chat/tool-approval-policy'
import { approvalHold } from '@/lib/chat/tool-approval-policy'
import { toastError } from '@/lib/notifications'
import {
  serializeBlocksToMarkdown,
  setEditorMarkdown,
} from '@/lib/tiptap/serialize'
import { api } from '@sb/convex/_generated/api'
import type { PathApprovalStatus } from '@sb/core/workspace/path-policy'
import type { Editor } from '@tiptap/react'
import type { ToolUIPart } from 'ai'
import { useMutation } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Owns approval mutations, note drafts, keyboard selection, and focus. */
export function useToolApprovalPicker({
  restoreFocusRef,
  onAbort,
  childApproval,
}: ToolApprovalPickerProps) {
  const session = useActiveSession()
  const state = useActiveSessionState()
  const approvals = childApproval?.toolApprovals ?? state?.toolApprovals
  const isAdmin = useIsAdmin()
  const processingMessageId = useStreamProcessingMessageId()
  const awaitingApproval = useStreamAwaitingApproval()
  const approveTool = useMutation(api.chat.approveTool).withOptimisticUpdate(
    optimisticallyRespondApproval,
  )
  const { message } = useChatMessage(processingMessageId ?? '')
  const rootRef = useRef<HTMLDivElement>(null)
  const noteEditorRef = useRef<Editor | null>(null)
  const draft = useComposerDraft(childApproval?.sessionId ?? session?._id)
  const [selectedAction, setSelectedAction] = useState('')

  const part = (childApproval?.parts ?? message?.parts)?.find(
    isApprovalRequested,
  ) as (ToolUIPart & { approvalPathStatus?: PathApprovalStatus }) | undefined
  const toolName = part?.type.replace('tool-', '') ?? ''
  const planApproval = PLAN_APPROVALS[toolName]
  const description = getDescription(part?.input)
  const hold =
    session && part && !planApproval
      ? approvalHold(
          toolName,
          part.input,
          childApproval ? childApproval.mode : session.mode,
          part.approvalPathStatus,
        )
      : null
  const rememberLabel =
    session && part && !planApproval && hold !== 'forbidden'
      ? alwaysLabel(toolName, part.input, approvals)
      : null
  const visible =
    isAdmin &&
    Boolean(childApproval || awaitingApproval) &&
    Boolean(session && part)

  const respond = useCallback(
    async (approved: boolean, remember?: RememberScope, note?: string) => {
      if (!session || !part) return
      draft.clear()
      try {
        await approveTool({
          sessionId: session._id,
          ...(childApproval ? { childSessionId: childApproval.sessionId } : {}),
          toolCallId: part.toolCallId,
          approved,
          ...(remember ? { remember } : {}),
          ...(!approved ? { reason: 'Denied by user.' } : {}),
          ...(note ? { note } : {}),
        })
        // Still mounted when further approvals are pending in the same turn
        const editor = noteEditorRef.current
        if (editor && !editor.isDestroyed) editor.commands.clearContent(true)
      } catch (err) {
        // The rolled back picker remounts its editor from the draft
        if (note) draft.flush(note)
        toastError(err)
      }
    },
    [approveTool, part, session, draft, childApproval],
  )

  const actions = useMemo(
    () =>
      buildApprovalActions(
        Boolean(isAdmin && session && part),
        rememberLabel,
        hold,
        planApproval,
      ),
    [isAdmin, part, hold, planApproval, rememberLabel, session],
  )

  const selectAction = useCallback(
    (action: ApprovalAction) => {
      const editor = noteEditorRef.current
      const note = editor ? serializeBlocksToMarkdown(editor).trim() : ''
      if (action.abort) {
        // Preserve the note so it reappears in the composer after the abort
        draft.flush(note)
        onAbort?.()
        return
      }
      void respond(action.approved, action.remember, note || undefined)
    },
    [respond, onAbort, draft],
  )

  const handleNoteReady = useCallback(
    (editor: Editor) => {
      noteEditorRef.current = editor
      editor.on('update', () => draft.save(serializeBlocksToMarkdown(editor)))
      const saved = draft.read()
      if (saved) setEditorMarkdown(editor, saved)
    },
    [draft],
  )

  useSelectedApprovalAction(actions, setSelectedAction)

  useEffect(() => {
    if (!visible || !restoreFocusRef) return
    const restoreFocusTarget = restoreFocusRef.current
    return () => restoreFocusTarget?.focus({ preventScroll: true })
  }, [restoreFocusRef, visible])

  // Keep the picker focused as it appears and as the request changes
  useEffect(() => {
    if (visible) rootRef.current?.focus({ preventScroll: true })
  }, [visible, part?.toolCallId])

  const focusNote = useCallback(
    () => noteEditorRef.current?.commands.focus(),
    [],
  )

  useApprovalKeybinds({
    actions,
    onSelect: selectAction,
    selectedAction,
    setSelectedAction,
    visible,
    rootRef,
    focusNote,
  })

  return {
    visible,
    part,
    rootRef,
    planApproval,
    toolName,
    description,
    hold,
    actions,
    selectedAction,
    setSelectedAction,
    selectAction,
    handleNoteReady,
  }
}
