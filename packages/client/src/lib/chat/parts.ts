import type { FileItem } from '@/hooks'
import type {
  WorkspaceDirectoryLink,
  WorkspaceTextLink,
} from '@sb/core/types/workspace'
import { collapseToolError } from '@sb/core/utils/tool-errors'
import type { FileUIPart, ToolUIPart, UIMessage } from 'ai'
import { isFileUIPart, isReasoningUIPart, isTextUIPart, isToolUIPart } from 'ai'

export type PartGroup =
  | { type: 'single'; part: UIMessage['parts'][number]; index: number }
  | { type: 'files'; parts: FileUIPart[]; startIndex: number }
  | { type: 'tools'; toolName: string; parts: ToolUIPart[]; startIndex: number }

/**
 * A `@path/to/file` workspace reference. The optional snapshot (text/directory
 * only) is stored server-side for stable provider history and stripped before
 * reaching the client, so it is generally absent here.
 */
export type FileLinkPart = {
  type: 'file-link'
  path: string
  snapshot?: WorkspaceTextLink | WorkspaceDirectoryLink
}

export function isFileLinkPart(part: unknown): part is FileLinkPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: string }).type === 'file-link'
  )
}

export type PlanLinkPart = {
  type: 'plan-link'
  /** Snapshot content is stripped before reaching the client. */
  snapshot: { content?: string; status: 'draft' | 'approved' }
}

export function isPlanLinkPart(part: unknown): part is PlanLinkPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: string }).type === 'plan-link'
  )
}

/**
 * A finished sub-agent's report, delivered to the parent session
 * as its own message.
 */
export type SubagentReportPart = {
  type: 'subagent-report'
  sessionId: string
  agentName: string
  title?: string
  status: 'complete' | 'failed' | 'stopped'
  text: string
}

export function isSubagentReportPart(
  part: unknown,
): part is SubagentReportPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: string }).type === 'subagent-report'
  )
}

// Tools whose consecutive calls collapse into a single grouped block
const GROUPED_TOOLS = new Set(['read_file', 'shell'])

export function groupParts(parts: UIMessage['parts']): PartGroup[] {
  const groups: PartGroup[] = []
  let i = 0

  while (i < parts.length) {
    if (isFileUIPart(parts[i])) {
      const startIndex = i
      const fileParts: FileUIPart[] = []

      while (i < parts.length && isFileUIPart(parts[i])) {
        fileParts.push(parts[i] as FileUIPart)
        i++
      }

      groups.push({ type: 'files', parts: fileParts, startIndex })
      continue
    }

    const toolName = groupableToolName(parts[i])
    if (toolName) {
      const startIndex = i
      const toolParts: ToolUIPart[] = []

      while (i < parts.length) {
        toolParts.push(parts[i] as ToolUIPart)
        const next = nextContentIndex(parts, i + 1)
        if (
          next >= parts.length ||
          groupableToolName(parts[next]) !== toolName
        ) {
          i++
          break
        }
        i = next
      }

      groups.push({ type: 'tools', toolName, parts: toolParts, startIndex })
      continue
    }

    groups.push({ type: 'single', part: parts[i], index: i })
    i++
  }

  return groups
}

const groupCache = new WeakMap<UIMessage['parts'], PartGroup[]>()

export function groupPartsCached(parts: UIMessage['parts']): PartGroup[] {
  let groups = groupCache.get(parts)
  if (!groups) {
    groups = groupParts(parts)
    groupCache.set(parts, groups)
  }
  return groups
}

export function groupKey(group: PartGroup): string {
  if (group.type === 'tools') {
    return `tools:${group.parts[0]?.toolCallId ?? group.startIndex}`
  }
  if (group.type === 'files') {
    return `files:${group.startIndex}`
  }

  const { part, index } = group
  if (isToolUIPart(part)) return `tool:${part.toolCallId}`
  // Other parts have no id
  return `${part.type}:${index}`
}

export function isRenderablePartGroup(group: PartGroup): boolean {
  if (group.type === 'files' || group.type === 'tools') {
    return group.parts.length > 0
  }

  const { part } = group
  if (isFileLinkPart(part) || isPlanLinkPart(part)) return true
  if (isSubagentReportPart(part)) return true
  if (isTextUIPart(part) || isReasoningUIPart(part)) {
    return part.text.trim().length > 0
  }
  if (isToolUIPart(part)) return part.type !== 'dynamic-tool'
  return false
}

export function groupPartIndices(
  messageParts: UIMessage['parts'],
  group: PartGroup,
): number[] {
  if (group.type === 'single') return [group.index]
  return group.parts
    .map((part) => messageParts.indexOf(part))
    .filter((index) => index >= 0)
}

/** Addresses one part within a message's selected version. */
export type PartAddress = { segmentIndex: number; partIndex: number }

/** Addresses of a group's parts within its segment. */
export function groupPartAddresses(
  segmentIndex: number,
  segmentParts: UIMessage['parts'],
  group: PartGroup,
): PartAddress[] {
  return groupPartIndices(segmentParts, group).map((partIndex) => ({
    segmentIndex,
    partIndex,
  }))
}

/**
 * The address of a group's first part. The server expands it across all
 * later parts and segments for "delete from here".
 */
export function fromAddressForGroup(
  segmentIndex: number,
  group: PartGroup,
): PartAddress {
  return {
    segmentIndex,
    partIndex: group.type === 'single' ? group.index : group.startIndex,
  }
}

export function isPreliminary(part: ToolUIPart): boolean {
  return (
    part.state === 'output-available' &&
    Boolean((part as { preliminary?: boolean }).preliminary)
  )
}

export function getToolStatus(
  part: ToolUIPart,
): 'pending' | 'running' | 'complete' | 'error' {
  switch (part.state) {
    case 'input-streaming':
      return 'running'
    case 'input-available':
    case 'approval-requested':
    case 'approval-responded':
      return 'pending'
    case 'output-available':
      if (getToolErrorText(part)) return 'error'
      if (isPreliminary(part)) return 'running'
      return 'complete'
    case 'output-error':
    case 'output-denied':
      return 'error'
    default:
      return 'pending'
  }
}

export function isToolInFlight(part: ToolUIPart): boolean {
  if (getToolStatus(part) === 'running') return true

  return part.state === 'input-available' || part.state === 'approval-responded'
}

export function getToolErrorText(part: ToolUIPart) {
  if (part.state !== 'output-error') return undefined
  return part.errorText === undefined
    ? undefined
    : collapseToolError(part.errorText)
}

export function buildFileItemFromPart(
  part: FileUIPart,
  originalUrl?: string,
  previewUrl?: string,
): FileItem {
  const isPlaceholder = part.url.startsWith('attachment:')
  const isDataUrl = part.url.startsWith('data:')

  const isKnownUrl =
    isDataUrl || part.url.startsWith('http') || part.url.startsWith('blob:')

  let type = part.mediaType ?? 'application/octet-stream'
  if (isDataUrl && !part.mediaType) {
    const matches = part.url.match(/^data:([^;]+)/)
    if (matches) type = matches[1]
  }

  const url = isPlaceholder
    ? (previewUrl ?? originalUrl ?? part.url)
    : isKnownUrl
      ? part.url
      : `data:${type};base64,${part.url}`

  let filename = part.filename
  if (!filename) {
    if (isDataUrl || isPlaceholder || !isKnownUrl) {
      const extension = type.split('/')[1]?.split('+')[0] || 'bin'
      filename = `attachment.${extension}`
    } else {
      filename = part.url.split('/').pop()?.split('?')[0] || 'attachment'
    }
  }

  return {
    url,
    originalUrl,
    file: new File([], filename, { type }),
  }
}

function groupableToolName(
  part: UIMessage['parts'][number],
): string | undefined {
  if (!part.type.startsWith('tool-')) return undefined
  const name = part.type.slice('tool-'.length)
  return GROUPED_TOOLS.has(name) ? name : undefined
}

function nextContentIndex(parts: UIMessage['parts'], from: number): number {
  // Find the next part that is not a step boundary, so tool runs
  // split across steps still group together.
  let i = from
  while (i < parts.length && parts[i].type === 'step-start') i++
  return i
}
