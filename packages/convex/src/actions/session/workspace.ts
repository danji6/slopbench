'use node'

import type {
  WorkspaceFileLink,
  WorkspaceLinkSnapshot,
} from '@sb/core/types/workspace'
import { MAX_BINARY_LINK_BYTES } from '@sb/core/workspace/files'

import { api, internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { error } from '../../errors'
import { authorizeAdmin } from '../../functions'
import { decodeBase64 } from '../../model/io/base64'
import type { SessionMode } from '../../types'

export async function createSession(
  ctx: ActionCtx,
  args: {
    activeAgentId?: Id<'agents'>
    workspaceRoot?: string
    mode?: SessionMode
  },
): Promise<{ sessionId: Id<'sessions'> }> {
  const { sessionId } = await ctx.runMutation(api.sessions.create, {
    activeAgentId: args.activeAgentId,
    // Plan mode only applies to workspace-bound sessions
    mode: args.workspaceRoot ? args.mode : undefined,
  })
  if (args.workspaceRoot) {
    await bindWorkspace(ctx, { sessionId, root: args.workspaceRoot })
  }
  return { sessionId }
}

export async function listDirectories(
  ctx: ActionCtx,
  args: { path?: string },
): Promise<{
  path: string
  parent?: string
  entries: Array<{ name: string; path: string }>
}> {
  await authorizeAdmin(ctx)
  return postWorkspaceSidecar('/workspace/list-directories', {
    path: args.path,
  })
}

export async function listWorkspaceFiles(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'> },
): Promise<{ files: string[]; truncated: boolean }> {
  const data = await requireAdminWorkspaceAction(ctx, args.sessionId)
  if (!data.workspace) error('No workspace configured', 409)
  return postWorkspaceSidecar('/workspace/list-files', {
    sessionId: args.sessionId,
    workspaceId: data.workspace.workspaceId,
  })
}

export async function listFilesByRoot(
  ctx: ActionCtx,
  args: { root: string },
): Promise<{ files: string[]; truncated: boolean }> {
  await authorizeAdmin(ctx)
  return postWorkspaceSidecar('/workspace/list-files-by-root', {
    root: args.root,
  })
}

/**
 * Read a linked file's contents for context injection.
 * Called only from an authorized action.
 */
export async function readWorkspaceFileLink(args: {
  sessionId: Id<'sessions'>
  workspaceId: string
  path: string
}): Promise<WorkspaceFileLink> {
  return postWorkspaceSidecar('/workspace/read-file', args)
}

type ResolvedFileLink = {
  path: string
  snapshot?: WorkspaceLinkSnapshot<Id<'_storage'>>
}

/**
 * Resolve `@path` mentions against the workspace. Every link is snapshotted
 * here: text and directories inline, binaries by reference into storage.
 */
export async function resolveFileLinks(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'>; paths: string[] },
): Promise<ResolvedFileLink[]> {
  const data = await requireAdminWorkspaceAction(ctx, args.sessionId)
  const workspace = data.workspace
  if (!workspace) error('No workspace configured', 409)

  const unique = [...new Set(args.paths)]
  const results = await Promise.allSettled(
    unique.map(async (path) => {
      const link = await readWorkspaceFileLink({
        sessionId: args.sessionId,
        workspaceId: workspace.workspaceId,
        path,
      })
      return {
        path: link.path,
        snapshot:
          link.kind === 'binary' ? await freezeBinaryLink(ctx, link) : link,
      }
    }),
  )

  return results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
}

/**
 * Moves a binary link's bytes into storage so history resolves them from an
 * immutable blob instead of re-reading the workspace on every request. Files
 * over the cap stay linkable but are never injected.
 */
async function freezeBinaryLink(
  ctx: ActionCtx,
  link: Extract<WorkspaceFileLink, { kind: 'binary' }>,
): Promise<WorkspaceLinkSnapshot<Id<'_storage'>>> {
  const bytes = decodeBase64(link.base64)
  if (bytes.byteLength > MAX_BINARY_LINK_BYTES) {
    return {
      kind: 'skipped',
      path: link.path,
      reason: `larger than ${MAX_BINARY_LINK_BYTES} bytes`,
    }
  }

  const storageId = await ctx.storage.store(
    new Blob([bytes as BlobPart], { type: link.mediaType }),
  )
  return {
    kind: 'binary-ref',
    path: link.path,
    storageId,
    mediaType: link.mediaType,
    filename: link.filename,
  }
}

export async function bindWorkspace(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'>; root: string },
): Promise<{ workspaceId: string; label: string; path: string }> {
  await requireAdminWorkspaceAction(ctx, args.sessionId)
  const workspace = await postWorkspaceSidecar<{
    workspaceId: string
    label: string
    path: string
  }>('/workspace/bind', { sessionId: args.sessionId, root: args.root })
  await ctx.runMutation(internal.sessions._patchWorkspace, {
    sessionId: args.sessionId,
    workspace,
  })
  return workspace
}

export async function clearWorkspace(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'> },
): Promise<void> {
  const data = await requireAdminWorkspaceAction(ctx, args.sessionId)
  await postWorkspaceSidecar('/workspace/clear', {
    sessionId: args.sessionId,
    workspaceId: data.workspace?.workspaceId,
  })
  await ctx.runMutation(internal.sessions._patchWorkspace, {
    sessionId: args.sessionId,
    workspace: null,
  })
}

export async function restoreCheckpoint(
  ctx: ActionCtx,
  args: { sessionId: Id<'sessions'> },
): Promise<{ restored: string; checkpointId: string }> {
  const data = await requireAdminWorkspaceAction(ctx, args.sessionId)
  if (!data.workspace) error('No workspace configured', 409)
  return postWorkspaceSidecar<{ restored: string; checkpointId: string }>(
    '/workspace/restore-latest',
    {
      sessionId: args.sessionId,
      workspaceId: data.workspace.workspaceId,
    },
  )
}

async function requireAdminWorkspaceAction(
  ctx: ActionCtx,
  sessionId: Id<'sessions'>,
): Promise<{ workspace?: { workspaceId: string; label: string } }> {
  const identity = await authorizeAdmin(ctx)
  return ctx.runQuery(internal.sessions._getWorkspaceContext, {
    sessionId,
    subject: identity.subject,
  })
}

async function postWorkspaceSidecar<T>(path: string, body: unknown) {
  const { postSidecar } = await import('../../model/sidecar')
  return postSidecar<T>(path, body)
}
