import type { MutationCtx } from '../../_generated/server'
import type { Session } from '../../types'
import { injectWorkspaceNote } from '../chat/notes'
import { workspaceKey } from './folderContext'

/** Announces a changed source set once, before the next invocation. */
export async function announceFolderContext(
  ctx: MutationCtx,
  session: Session,
) {
  const key = workspaceKey(session.workspace)
  if (session.workspaceRevision === key) return null
  const messageId = await injectWorkspaceNote(
    ctx,
    { ...session, workspace: session.announcedWorkspace },
    session.workspace,
  )
  await ctx.db.patch(session._id, {
    workspaceRevision: key,
    announcedWorkspace: session.workspace,
  })
  return messageId ? ctx.db.get(messageId) : null
}
