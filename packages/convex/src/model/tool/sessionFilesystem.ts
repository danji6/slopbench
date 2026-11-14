import { sharedSessionId } from '../../lib/subagent'
import type { Session } from '../../types'

export function filesystemWorkspace(
  session: Pick<Session, '_id' | 'workspace' | 'parent'>,
) {
  if (session.workspace) return { ...session.workspace, sessionFiles: true }
  return {
    workspaceId: sharedSessionId(session),
    path: '.',
    label: 'Session directory',
    sessionFiles: true,
    sessionOnly: true,
  }
}
