import {
  useActiveSession,
  useChatMessage,
  useIsAdmin,
  useStreamAwaitingApproval,
  useStreamProcessingMessageId,
} from '@/hooks/chat'
import type { ApproveToolArgs, RememberScope, ToolApprovals } from '@/lib/chat'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import {
  analyzeShellCommand,
  commandReferencesForbiddenPath,
  isPathForbidden,
  isReadOnlyShellCommand,
} from '@sb/convex/lib/tool/approval'
import type { ToolUIPart } from 'ai'
import type { OptimisticLocalStore } from 'convex/browser'
import { useMutation } from 'convex/react'
import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Code } from '../../ui'
import { Command } from '../../ui/command'

type ApprovalAction = {
  id: string
  label: string
  shortcut: string
  remember?: RememberScope
  approved: boolean
  abort?: boolean
}

type PlanApprovalMeta = {
  heading: string
  approveLabel: string
  denyLabel: string
}

const PLAN_APPROVALS: Record<string, PlanApprovalMeta> = {
  exit_plan_mode: {
    heading: 'The agent wants to start implementing the plan.',
    approveLabel: 'Approve plan',
    denyLabel: 'Keep planning',
  },
  enter_plan_mode: {
    heading: 'The agent wants to plan before making changes.',
    approveLabel: 'Enter plan mode',
    denyLabel: 'Decline',
  },
}

export function ToolApprovalPicker({
  className,
  restoreFocusRef,
  onAbort,
}: {
  className?: string
  restoreFocusRef?: RefObject<{ focus(options?: FocusOptions): void } | null>
  onAbort?: () => void
}) {
  const session = useActiveSession()
  const isAdmin = useIsAdmin()
  const processingMessageId = useStreamProcessingMessageId()
  const awaitingApproval = useStreamAwaitingApproval()
  const approveTool = useMutation(api.chat.approveTool).withOptimisticUpdate(
    optimisticallyRespondApproval,
  )
  const { message } = useChatMessage(processingMessageId ?? '')
  const rootRef = useRef<HTMLDivElement>(null)
  const [selectedAction, setSelectedAction] = useState('')

  const part = message?.parts.find(isApprovalRequested) as
    ToolUIPart | undefined
  const toolName = part?.type.replace('tool-', '') ?? ''
  const planApproval = PLAN_APPROVALS[toolName]
  const hold =
    session && part && !planApproval
      ? approvalHold(toolName, part.input, session)
      : null
  const rememberLabel =
    session && part && !planApproval && hold !== 'forbidden'
      ? alwaysLabel(toolName, part.input, session.toolApprovals)
      : null
  const visible =
    isAdmin && awaitingApproval && Boolean(session && message && part)

  const respond = useCallback(
    async (approved: boolean, remember?: RememberScope) => {
      if (!session || !part) return
      try {
        await approveTool({
          sessionId: session._id,
          toolCallId: part.toolCallId,
          approved,
          ...(remember ? { remember } : {}),
          ...(!approved ? { reason: 'Denied by user.' } : {}),
        })
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err))
      }
    },
    [approveTool, part, session],
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
      if (action.abort) {
        onAbort?.()
        return
      }
      void respond(action.approved, action.remember)
    },
    [respond, onAbort],
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

  useApprovalKeybinds({
    actions,
    onSelect: selectAction,
    selectedAction,
    setSelectedAction,
    visible,
    rootRef,
  })

  if (!visible || !part) return null

  return (
    <div
      data-slot="tool-approval-picker"
      ref={rootRef}
      tabIndex={-1}
      className={cn(
        'bg-m3-surface-container-low w-full overflow-hidden rounded-xl border shadow-lg outline-none',
        className,
      )}
    >
      <div className="space-y-2 p-3">
        {planApproval ? (
          <div className="text-foreground text-sm font-medium">
            {planApproval.heading}
          </div>
        ) : (
          <div className="text-sm">
            <span className="text-muted-foreground">Approve:</span>{' '}
            <span className="text-foreground font-medium">
              {part.title || toolName}
            </span>
          </div>
        )}
        {!planApproval && (
          <Code
            text={summarizeInput(part.input)}
            language={toolName === 'shell' ? 'shell' : undefined}
            innerClassName="max-h-40"
            noLoadingIndicator
            wordWrap
          />
        )}
        {hold && (
          <div className="text-muted-foreground text-xs">
            {HOLD_HINTS[hold]}
          </div>
        )}
        <Command
          shouldFilter={false}
          value={selectedAction}
          onValueChange={setSelectedAction}
        >
          <Command.CommandList>
            {actions.map((action) => (
              <Command.CommandItem
                key={action.id}
                value={action.id}
                onSelect={() => selectAction(action)}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5"
              >
                <span className="text-sm font-medium">{action.label}</span>
                <kbd
                  data-slot="command-shortcut"
                  className="text-muted-foreground bg-muted ml-auto rounded px-1.5 py-0.5 font-mono text-[11px] uppercase"
                >
                  {action.shortcut}
                </kbd>
              </Command.CommandItem>
            ))}
          </Command.CommandList>
        </Command>
      </div>
    </div>
  )
}

function buildApprovalActions(
  enabled: boolean,
  rememberLabel: string | null,
  hold: ApprovalHold,
  planApproval?: PlanApprovalMeta,
): ApprovalAction[] {
  if (!enabled) return []

  const items: ApprovalAction[] = [
    {
      id: 'approve',
      label: planApproval?.approveLabel ?? 'Allow',
      shortcut: 'y',
      approved: true,
    },
  ]

  if (hold === 'paths') {
    items.push({
      id: 'remember-paths',
      label: 'Always allow these paths for this session',
      shortcut: 'a',
      approved: true,
      remember: 'paths',
    })
  } else if (rememberLabel) {
    items.push({
      id: 'remember-patterns',
      label: rememberLabel,
      shortcut: 'a',
      approved: true,
      remember: 'patterns',
    })
  }

  items.push({
    id: 'deny',
    label: planApproval?.denyLabel ?? 'Deny',
    shortcut: 'n',
    approved: false,
  })

  items.push({
    id: 'abort',
    label: 'Abort',
    shortcut: 'x',
    approved: false,
    abort: true,
  })

  return items
}

function useSelectedApprovalAction(
  actions: ApprovalAction[],
  setSelectedAction: (value: string) => void,
) {
  const actionSignature = actions.map((action) => action.id).join('|')
  const [prevActionSignature, setPrevActionSignature] =
    useState(actionSignature)

  if (prevActionSignature !== actionSignature) {
    setPrevActionSignature(actionSignature)
    setSelectedAction(actions[0]?.id ?? '')
  }
}

function useApprovalKeybinds({
  actions,
  onSelect,
  selectedAction,
  setSelectedAction,
  visible,
  rootRef,
}: {
  actions: ApprovalAction[]
  onSelect: (action: ApprovalAction) => void
  selectedAction: string
  setSelectedAction: (value: string) => void
  visible: boolean
  rootRef: React.RefObject<HTMLDivElement | null>
}) {
  useEffect(() => {
    if (!visible || actions.length === 0) return

    function handleKeyDown(e: KeyboardEvent) {
      const root = rootRef.current
      if (!root || !root.contains(document.activeElement)) return

      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        const key = e.key.toLowerCase()
        const action = actions.find((item) => item.shortcut === key)
        if (action) {
          e.preventDefault()
          onSelect(action)
          return
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const idx = actions.findIndex((action) => action.id === selectedAction)
        setSelectedAction(actions[(idx + 1) % actions.length]!.id)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = actions.findIndex((action) => action.id === selectedAction)
        setSelectedAction(
          actions[(idx - 1 + actions.length) % actions.length]!.id,
        )
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const action = actions.find((item) => item.id === selectedAction)
        if (action) onSelect(action)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [actions, onSelect, rootRef, selectedAction, setSelectedAction, visible])
}

function optimisticallyRespondApproval(
  store: OptimisticLocalStore,
  args: ApproveToolArgs,
) {
  const stream = store.getQuery(api.chat.getActiveStream, {
    sessionId: args.sessionId,
  })
  if (!stream || stream.status !== 'awaiting_approval') return

  let pendingRemains = false
  for (const { args: queryArgs, value } of store.getAllQueries(
    api.chat.messagesWindow,
  )) {
    if (!value || queryArgs.sessionId !== args.sessionId) continue

    const page = value.page.map((message) => {
      if (message._id !== stream.processingMessageId) return message
      return {
        ...message,
        segments: message.segments.map((segment) => ({
          ...segment,
          parts: respondToPart(segment.parts, args),
        })),
      }
    })
    store.setQuery(api.chat.messagesWindow, queryArgs, { ...value, page })

    const target = page.find((m) => m._id === stream.processingMessageId)
    if (
      target &&
      target.segments.some((segment) => hasApprovalRequested(segment.parts))
    ) {
      pendingRemains = true
    }
  }

  if (!pendingRemains) {
    store.setQuery(
      api.chat.getActiveStream,
      { sessionId: args.sessionId },
      { ...stream, status: 'pending' },
    )
  }
}

function respondToPart(parts: unknown[], args: ApproveToolArgs): unknown[] {
  return parts.map((part) => {
    if (
      typeof part !== 'object' ||
      part === null ||
      !('toolCallId' in part) ||
      part.toolCallId !== args.toolCallId
    ) {
      return part
    }
    const typed = part as { state?: string; approval?: { id?: string } }
    if (typed.state !== 'approval-requested') return part

    return {
      ...typed,
      state: args.approved ? 'approval-responded' : 'output-denied',
      approval: {
        id: typed.approval?.id,
        approved: args.approved,
        ...(args.reason && { reason: args.reason }),
      },
    }
  })
}

function hasApprovalRequested(parts: unknown[]): boolean {
  return parts.some(
    (part) =>
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      typeof part.type === 'string' &&
      part.type.startsWith('tool-') &&
      'state' in part &&
      part.state === 'approval-requested',
  )
}

function isApprovalRequested(part: { type: string; state?: string }) {
  return part.type.startsWith('tool-') && part.state === 'approval-requested'
}

function summarizeInput(input: unknown): string {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    if (typeof record.command === 'string') return record.command
    if (typeof record.path === 'string') return record.path
  }
  return JSON.stringify(input ?? {}, null, 2)
}

function getCommand(input: unknown): string | null {
  const command = (input as { command?: string } | undefined)?.command
  return typeof command === 'string' ? command : null
}

function alwaysLabel(
  toolName: string,
  input: unknown,
  approvals: ToolApprovals | undefined,
): string | null {
  if (toolName !== 'shell') return 'Always allow for this session'

  const command = getCommand(input)
  if (command === null) return null

  const { unapproved } = analyzeShellCommand(command, approvals?.shell ?? [])
  if (unapproved.length === 0) return null

  const list = unapproved.map((pattern) => `\`${pattern}\``).join(', ')
  return `Always allow ${list} for this session`
}

/** Why an otherwise covered call still needs approval. */
type ApprovalHold = 'forbidden' | 'plan' | 'paths' | null

// prettier-ignore
const HOLD_HINTS: Record<NonNullable<ApprovalHold>, string> = {
  forbidden: 'This accesses a forbidden path and always requires approval.',
  plan: 'Plan mode is active and this command is not read-only.',
  paths: 'This command references git-ignored files or paths outside the workspace.',
}

function approvalHold(
  toolName: string,
  input: unknown,
  session: { mode?: string; toolApprovals?: ToolApprovals },
): ApprovalHold {
  if (toolName !== 'shell') {
    const path = (input as { path?: string } | undefined)?.path
    return typeof path === 'string' && isPathForbidden(path)
      ? 'forbidden'
      : null
  }

  const command = getCommand(input)
  if (command === null) return null
  if (commandReferencesForbiddenPath(command)) return 'forbidden'
  if (session.mode === 'plan' && !isReadOnlyShellCommand(command)) return 'plan'

  const { patterns, unapproved, unsafe } = analyzeShellCommand(
    command,
    session.toolApprovals?.shell ?? [],
  )
  return !unsafe && patterns.length > 0 && unapproved.length === 0
    ? 'paths'
    : null
}
