import type { ToolApprovalPickerProps } from '@/components/chat/workspace/tool-approval-picker'
import type { RememberScope } from '@/lib/chat'
import { optimisticallyRespondApproval } from '@/lib/chat/approval-optimistic'
import { createTextDraftStore } from '@/lib/chat/text-draft-store'
import {
  type ApprovalAction,
  buildApprovalActions,
} from '@/lib/chat/tool-approval-policy'
import { toastError } from '@/lib/notifications'
import {
  serializeBlocksToMarkdown,
  setEditorMarkdown,
} from '@/lib/tiptap/serialize'
import { api } from '@cv/convex/_generated/api'
import { alwaysLabel, approvalHold } from '@cv/convex/lib/tool/approvalPolicy'
import { PLAN_APPROVALS, getDescription } from '@cv/core/approval-presentation'
import { APP_ID } from '@cv/core/const'
import { isPendingToolApproval } from '@cv/core/utils/tool-parts'
import type { PathApprovalStatus } from '@cv/core/workspace/path-policy'
import type { Editor } from '@tiptap/react'
import type { ToolUIPart } from 'ai'
import { useMutation } from 'convex/react'
import { useCallback, useRef } from 'react'

import { useChatMessage } from './messages'
import { useActiveSession, useActiveSessionState } from './session'
import { useStreamProcessingMessageId } from './stream'

const notes = createTextDraftStore(`${APP_ID}-approval-note-drafts`)

export type PendingToolApproval = {
  key: string
  part: ToolUIPart & { approvalPathStatus?: PathApprovalStatus }
}

type PendingApprovalOptions = {
  childApproval?: ToolApprovalPickerProps['childApproval']
  awaitingApproval: boolean
  canApproveTools: boolean
}

export function usePendingToolApproval({
  childApproval,
  awaitingApproval,
  canApproveTools,
}: PendingApprovalOptions): PendingToolApproval | undefined {
  const session = useActiveSession()
  const processingMessageId = useStreamProcessingMessageId()
  const { message } = useChatMessage(
    canApproveTools && awaitingApproval ? (processingMessageId ?? '') : '',
  )

  if (!canApproveTools || !session) return

  const part = (childApproval?.parts ?? message?.parts)?.find(
    isPendingToolApproval,
  ) as PendingToolApproval['part'] | undefined
  if (!part) return

  const sessionId = childApproval?.sessionId ?? session._id
  return { key: JSON.stringify([sessionId, part.toolCallId]), part }
}

/** Owns the decision and note for the request currently under review. */
export function useToolApprovalPicker({
  request,
  onAbort,
  childApproval,
}: Pick<ToolApprovalPickerProps, 'request' | 'onAbort' | 'childApproval'>) {
  const session = useActiveSession()
  const state = useActiveSessionState()
  const { part, key } = request
  const approvals = childApproval?.toolApprovals ?? state?.toolApprovals
  const approveTool = useMutation(api.chat.approveTool).withOptimisticUpdate(
    optimisticallyRespondApproval,
  )
  const noteEditorRef = useRef<Editor | null>(null)
  const responding = useRef(false)

  const toolName = part.type.replace('tool-', '')
  const planApproval = PLAN_APPROVALS[toolName]
  const description = getDescription(part.input)
  const hold =
    session && !planApproval
      ? approvalHold(
          toolName,
          part.input,
          childApproval ? childApproval.mode : session.mode,
          part.approvalPathStatus,
        )
      : null
  const rememberLabel =
    session && !planApproval && hold !== 'forbidden'
      ? alwaysLabel(toolName, part.input, approvals)
      : null

  async function respond(approved: boolean, remember?: RememberScope) {
    if (!session || responding.current) return
    responding.current = true
    try {
      const editor = noteEditorRef.current
      const note = (editor ? serializeBlocksToMarkdown(editor) : notes.read(key)).trim() // prettier-ignore
      const childSessionId =
        childApproval?.sessionId ?? (session.parent ? session._id : undefined)
      await approveTool({
        sessionId: session.parent?.sessionId ?? session._id,
        ...(childSessionId ? { childSessionId } : {}),
        toolCallId: part.toolCallId,
        approved,
        ...(remember ? { remember } : {}),
        ...(!approved ? { reason: 'Denied by user.' } : {}),
        ...(note ? { note } : {}),
      })
      notes.clear(key)
    } catch (err) {
      toastError(err)
    } finally {
      responding.current = false
    }
  }

  function selectAction(action: ApprovalAction) {
    if (action.abort) onAbort?.()
    else void respond(action.approved, action.remember)
  }

  const handleNoteReady = useCallback(
    (editor: Editor) => {
      if (noteEditorRef.current === editor) return
      noteEditorRef.current = editor
      const saved = notes.read(key)
      if (saved) setEditorMarkdown(editor, saved)
      editor.on('update', () => {
        notes.write(key, serializeBlocksToMarkdown(editor))
      })
    },
    [key],
  )

  return {
    planApproval,
    toolName,
    description,
    hold,
    actions: buildApprovalActions(
      Boolean(session),
      rememberLabel,
      hold,
      planApproval,
    ),
    selectAction,
    handleNoteReady,
  }
}
