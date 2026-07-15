import { abbreviateNumber } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { capitalize } from '@sb/core/utils/strings'
import type { ToolUIPart } from 'ai'
import { useQuery } from 'convex/react'
import { ExternalLinkIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import { SessionAvatar } from '../../sessions/session-avatar'
import type { ToolRendererProps } from './tool-part-block'
import { ToolShell } from './tool-shell'

type TaskInput = { agent_name?: string; prompt?: string; title?: string }

type TaskPart = ToolUIPart & { subagentSessionId?: string }

/**
 * Renders a `task` tool call as a compact label for the sub-agent's background
 * work, showing its identity, live status, and token use. Can be clicked to
 * open the child session.
 */
export function SubagentBlock({
  part,
  messageId,
  forceError,
}: ToolRendererProps) {
  const [, navigate] = useLocation()
  const input = part.input as TaskInput | undefined
  const childSessionId = (part as TaskPart).subagentSessionId as
    | Id<'sessions'>
    | undefined

  const live = useQuery(
    api.subagents.watch,
    childSessionId ? { sessionId: childSessionId } : 'skip',
  )

  return (
    <ToolShell
      data-slot="subagent-block"
      part={part}
      messageId={messageId}
      forceError={forceError}
      onLabelClick={
        childSessionId ? () => navigate(`/?id=${childSessionId}`) : undefined
      }
      label={
        <SubagentLabel
          name={live?.agent?.name ?? input?.agent_name}
          avatarId={live?.agent?.avatarId}
          title={input?.title}
          status={subagentStatus(part.state, childSessionId, live)}
          tokens={live?.tokens ?? null}
          linked={Boolean(childSessionId)}
        />
      }
    />
  )
}

function subagentStatus(
  state: ToolUIPart['state'],
  childSessionId: string | undefined,
  live: { status: string | null } | null | undefined,
): string | null {
  if (state === 'output-error') return 'failed'
  if (!childSessionId) return state === 'input-available' ? 'starting' : null
  if (live === undefined) return null // subscription still loading
  return live?.status ? 'running' : 'done'
}

function SubagentLabel({
  name,
  avatarId,
  title,
  status,
  tokens,
  linked,
}: {
  name: string | undefined
  avatarId?: Id<'avatars'>
  title: string | undefined
  status: string | null
  tokens: number | null
  linked: boolean
}) {
  return (
    <span className="text-muted-foreground flex min-w-0 items-center gap-2">
      <SessionAvatar avatarId={avatarId} noHover size="xs" />
      <span className="text-foreground font-semibold">
        {name ?? 'Sub-agent'}
      </span>
      {title && (
        <>
          <span className="shrink-0">•</span>
          <span className="font-normal">{title}</span>
        </>
      )}
      {status && (
        <>
          <span className="shrink-0">•</span>
          <span className="text-xs">{capitalize(status)}</span>
        </>
      )}
      {tokens ? (
        <>
          <span className="shrink-0">•</span>
          <span className="shrink-0 text-xs tabular-nums">
            {abbreviateNumber(tokens)} tokens
          </span>
        </>
      ) : null}
      {linked && (
        <ExternalLinkIcon className="size-3 shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />
      )}
    </span>
  )
}
