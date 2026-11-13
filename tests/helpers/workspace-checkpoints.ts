import type { FolderWorkspace } from '@cv/core/types/workspace'
import type { RestoreInput } from '@cv/sidecar/checkpoints/types'
import { randomUUID } from 'node:crypto'

type CaptureContext = {
  sessionId: string
  workspace: FolderWorkspace
}

/** Captures real file-tool edits through the sidecar's shared turn manager. */
export async function workspaceCheckpoint(context: CaptureContext) {
  const { checkpoints } = await import('@cv/sidecar/checkpoints/manager')
  const manager = checkpoints()
  const identity = {
    groupId: context.sessionId,
    participantId: context.sessionId,
    root: true,
  }
  await manager.begin({ ...identity, ...context })

  return {
    finish: () =>
      manager.finish({ ...identity, checkpointId: context.sessionId }),
    restore: (input: Partial<RestoreInput> = {}) =>
      manager.restore({
        ...context,
        checkpointId: context.sessionId,
        operationId: randomUUID(),
        revision: 0,
        direction: 'revert',
        allowedPaths: [],
        workspaces: [context.workspace],
        ...input,
      }),
    cleanup: () => manager.removeSession(context.sessionId),
  }
}
