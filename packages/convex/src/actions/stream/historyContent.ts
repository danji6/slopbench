'use node'

import {
  toDirectoryBlock,
  toFileBlock,
  toPlanBlock,
} from '@sb/convex/lib/workspace'
import type {
  WorkspaceBinaryRefLink,
  WorkspaceFileLink,
  WorkspaceSkippedLink,
} from '@sb/core/types/workspace'
import { block } from '@sb/core/utils/blocks'
import { blockPath } from '@sb/core/workspace/blocks'
import type { UIMessage } from 'ai'

import type { Doc, Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { isShellReportPart, toShellReportBlock } from '../../lib/shellReport'
import {
  isSubagentReportPart,
  sharedSessionId,
  toSubagentReportBlock,
} from '../../lib/subagent'
import { isShellToolPart, toUserShellBlock } from '../../lib/userShell'
import { encodeBase64 } from '../../model/io/base64'
import type { PlanLinkPart } from '../../model/plans'
import { hasOutputRef } from '../../model/stream/toolOutput'
import type { MessageRole } from '../../types'
import { readWorkspaceFileLink } from '../session/workspace'
import {
  type AttachmentResolveOptions,
  resolveAttachmentPart,
} from './attachmentHistory'

export async function resolveParts(
  ctx: ActionCtx,
  parts: unknown[],
  session: Doc<'sessions'>,
  role: MessageRole,
  attachmentOptions: AttachmentResolveOptions,
) {
  const expire = attachmentOptions.toolMediaActive
    ? undefined
    : (await import('../../model/tool/attachments')).expireAttachmentToolPart
  const resolved = await Promise.all(
    parts.map((part) =>
      resolvePart(
        ctx,
        expire?.(part) ?? part,
        session,
        role,
        attachmentOptions,
      ),
    ),
  )
  return resolved as UIMessage['parts']
}

export async function resolvePart(
  ctx: ActionCtx,
  part: unknown,
  session: Doc<'sessions'>,
  role: MessageRole,
  attachmentOptions: AttachmentResolveOptions,
) {
  if (role === 'user' && isShellToolPart(part)) {
    // Tool parts are stripped off user messages, so this becomes a text part
    return { type: 'text' as const, text: toUserShellBlock(part) }
  }
  if (hasOutputRef(part)) {
    return resolveOffloadedOutput(ctx, part)
  }
  if (isPlanLinkPart(part)) {
    return { type: 'text' as const, text: toPlanBlock(part.snapshot) }
  }
  if (isSubagentReportPart(part)) {
    return { type: 'text' as const, text: toSubagentReportBlock(part) }
  }
  if (isShellReportPart(part)) {
    return { type: 'text' as const, text: toShellReportBlock(part) }
  }
  if (isFileLinkPart(part)) {
    return resolveFileLink(ctx, part, session)
  }
  return resolveAttachmentPart(ctx, part, attachmentOptions)
}

export async function resolveOffloadedOutput(
  ctx: ActionCtx,
  part: { outputRef: Id<'_storage'> },
) {
  const blob = await ctx.storage.get(part.outputRef)
  if (!blob) return part
  try {
    const output: unknown = JSON.parse(await blob.text())
    return { ...part, output, outputRef: undefined }
  } catch {
    return part
  }
}

export async function resolveFileLink(
  ctx: ActionCtx,
  part: { type: 'file-link'; path: string; snapshot?: unknown },
  session: Doc<'sessions'>,
) {
  // Links snapshotted at send time never touch disk again
  const snapshot = part.snapshot
  if (isSkippedLink(snapshot)) return skippedFileLink(snapshot.path, snapshot.reason) // prettier-ignore
  if (isBinaryRefLink(snapshot)) return resolveBinaryRef(ctx, snapshot)
  if (isWorkspaceFileLink(snapshot)) return fileLinkToPart(snapshot)
  // Pre-snapshot parts and unresolvable sends fall back to a lazy read
  if (!session.workspace) return unavailableFileLink(part.path)

  try {
    const file = await readWorkspaceFileLink({
      sessionId: sharedSessionId(session),
      workspaceId: session.workspace.workspaceId,
      path: part.path,
    })
    return fileLinkToPart(file)
  } catch {
    return unavailableFileLink(part.path)
  }
}

export function isSkippedLink(value: unknown): value is WorkspaceSkippedLink {
  return (value as { kind?: string } | null)?.kind === 'skipped'
}

export function isBinaryRefLink(
  value: unknown,
): value is WorkspaceBinaryRefLink {
  return (value as { kind?: string } | null)?.kind === 'binary-ref'
}

export async function resolveBinaryRef(
  ctx: ActionCtx,
  link: WorkspaceBinaryRefLink,
) {
  const blob = await ctx.storage.get(link.storageId as Id<'_storage'>)
  if (!blob) return unavailableFileLink(link.path)

  const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()))
  return {
    type: 'file' as const,
    url: `data:${link.mediaType};base64,${base64}`,
    mediaType: link.mediaType,
    filename: link.filename,
  }
}

/** Names a link the user made but that is deliberately not injected. */
export function skippedFileLink(path: string, reason: string) {
  return {
    type: 'text' as const,
    text: block('file', `Not included: ${reason}.`, {
      path: blockPath(path),
      status: 'skipped',
    }),
  }
}

export function unavailableFileLink(path: string) {
  return {
    type: 'text' as const,
    text: block('file', 'This file is no longer available.', {
      path: blockPath(path),
      status: 'unavailable',
    }),
  }
}

export function fileLinkToPart(file: WorkspaceFileLink) {
  if (file.kind === 'text') {
    return { type: 'text' as const, text: toFileBlock(file) }
  }
  if (file.kind === 'directory') {
    return { type: 'text' as const, text: toDirectoryBlock(file) }
  }
  return {
    type: 'file' as const,
    url: `data:${file.mediaType};base64,${file.base64}`,
    mediaType: file.mediaType,
    filename: file.filename,
  }
}

export function isPlanLinkPart(part: unknown): part is PlanLinkPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'plan-link' &&
    'snapshot' in part &&
    typeof (part as { snapshot: unknown }).snapshot === 'object'
  )
}

export function isFileLinkPart(
  part: unknown,
): part is { type: 'file-link'; path: string; snapshot?: unknown } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    part.type === 'file-link' &&
    'path' in part &&
    typeof (part as { path: unknown }).path === 'string'
  )
}

export function isWorkspaceFileLink(
  value: unknown,
): value is WorkspaceFileLink {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return false
  }

  const link = value as Record<string, unknown>
  if (typeof link.path !== 'string') return false

  if (link.kind === 'text') {
    return (
      typeof link.content === 'string' && typeof link.truncated === 'boolean'
    )
  }

  if (link.kind === 'directory') {
    return (
      Array.isArray(link.entries) &&
      link.entries.every((entry) => typeof entry === 'string') &&
      typeof link.truncated === 'boolean'
    )
  }

  return (
    link.kind === 'binary' &&
    typeof link.base64 === 'string' &&
    typeof link.mediaType === 'string' &&
    typeof link.filename === 'string'
  )
}
