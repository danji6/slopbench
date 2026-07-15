import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { capitalize } from '@sb/core/utils/strings'
import type { ToolUIPart } from 'ai'
import { useQuery } from 'convex/react'
import { ExternalLinkIcon } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation } from 'wouter'

import { SessionAvatar } from '../../sessions/session-avatar'
import type { ToolRendererProps } from './tool-part-block'
import { ToolShell } from './tool-shell'

type TaskInput = { agent_name?: string; prompt?: string; title?: string }

type TaskPart = ToolUIPart & { subagentSessionId?: string }

type Preview = {
  text: string | null
  tool: { name: string; state: string } | null
}

// Cache for non-empty sub-agent previews, persisted across remounts for stable
// virtualization
const cache = new Map<string, Preview>()

const hasPreviewContent = (
  preview: Preview | null | undefined,
): preview is Preview => Boolean(preview?.text || preview?.tool)

/**
 * Renders a `task` tool call as a live preview of the sub-agent's background
 * work while it runs. Can be clicked to open the child session.
 */
export function SubagentBlock({
  part,
  messageId,
  forceError,
}: ToolRendererProps) {
  const [, navigate] = useLocation()
  const input = part.input as TaskInput | undefined
  const childSessionId = (part as TaskPart).subagentSessionId as
    Id<'sessions'> | undefined

  const live = useQuery(
    api.subagents.watch,
    childSessionId ? { sessionId: childSessionId } : 'skip',
  )

  const preview = usePersistentPreview(part.toolCallId, live?.tail)
  const showPreview = hasPreviewContent(preview)

  return (
    <ToolShell
      data-slot="subagent-block"
      part={part}
      messageId={messageId}
      forceError={forceError}
      autoExpand={showPreview}
      fullWidth={showPreview}
      onLabelClick={
        childSessionId ? () => navigate(`/?id=${childSessionId}`) : undefined
      }
      label={
        <SubagentLabel
          name={live?.agent?.name ?? input?.agent_name}
          avatarId={live?.agent?.avatarId}
          title={input?.title}
          status={subagentStatus(part.state, childSessionId, live)}
          linked={Boolean(childSessionId)}
        />
      }
    >
      {hasPreviewContent(preview) && <SubagentPreview preview={preview} />}
    </ToolShell>
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
  linked,
}: {
  name: string | undefined
  avatarId?: Id<'avatars'>
  title: string | undefined
  status: string | null
  linked: boolean
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {avatarId && <SessionAvatar avatarId={avatarId} noHover />}
      <span className="text-foreground min-w-0 truncate font-medium">
        {name ?? 'Sub-agent'}
        {title && (
          <>
            <span className="mx-1.5 shrink-0">•</span>
            <span className="text-muted-foreground font-normal">{title}</span>
          </>
        )}
      </span>
      {status && (
        <span className="text-muted-foreground text-xs">
          ({capitalize(status)})
        </span>
      )}
      {linked && (
        <ExternalLinkIcon className="text-muted-foreground size-3 shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />
      )}
    </span>
  )
}

function SubagentPreview({ preview }: { preview: Preview }) {
  if (!preview.text && !preview.tool) return null
  return (
    <div className="flex h-24 flex-col justify-end gap-1.5 overflow-hidden mask-[linear-gradient(to_bottom,transparent,#000_1.5rem)]">
      {preview.text && (
        <p className="text-muted-foreground text-xs whitespace-pre-wrap">
          {preview.text}
        </p>
      )}
      {preview.tool && (
        <p className="text-muted-foreground font-mono text-xs">
          {preview.tool.name}…
        </p>
      )}
    </div>
  )
}

function usePersistentPreview(
  id: string,
  preview: Preview | null | undefined,
): Preview | null {
  useEffect(() => {
    if (hasPreviewContent(preview)) cache.set(id, preview)
  }, [id, preview])
  return (hasPreviewContent(preview) ? preview : cache.get(id)) ?? null
}
