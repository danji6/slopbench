import { closeFileBlock, openFileBlock } from '@sb/convex/lib/workspace'

import { minRole } from '../../lib/roles'
import { sharedSessionId } from '../../lib/subagent'
import type { StreamContext } from '../../types'
import { postSidecar } from '../sidecar'

type WorkspaceInstructions = {
  path: string
  content: string
  truncated?: boolean
}

export function formatWorkspaceInstructions(
  instructions: WorkspaceInstructions,
) {
  return [
    openFileBlock(instructions.path),
    `${instructions.content}${instructions.truncated ? '[TRUNCATED]' : ''}`,
    closeFileBlock(),
  ].join('\n')
}

export async function tryReadWorkspaceInstructions(data: StreamContext) {
  const workspace = data.session.workspace
  if (!workspace || !minRole(data.invoker.role, 'admin')) {
    return null
  }

  try {
    return await postSidecar<WorkspaceInstructions | null>(
      '/workspace/instructions',
      {
        sessionId: sharedSessionId(data.session),
        workspaceId: workspace.workspaceId,
      },
    )
  } catch {
    return null
  }
}
