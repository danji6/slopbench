'use node'

import type { WorkspaceFileLink } from '@sb/core/types/workspace'

import { api, internal } from '../../_generated/api'
import type { Id } from '../../_generated/dataModel'
import type { ActionCtx } from '../../_generated/server'
import { error } from '../../errors'
import { authorizeAdmin } from '../../functions'
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
  snapshot?: Extract<WorkspaceFileLink, { kind: 'text' | 'directory' }>
}

/**
 * Resolve `@path` mentions against the workspace. Directories and plain
 * text files are snapshotted, while binary files are resolved lazily at
 * history build time.
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
      return link.kind === 'binary'
        ? { path: link.path }
        : { path: link.path, snapshot: link }
    }),
  )

  return results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
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
