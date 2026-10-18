import type { FolderWorkspace } from '@sb/core/types/workspace'
import { realpath, stat } from 'node:fs/promises'

import { assertPlainPath } from '../../agent-files/storage'

export async function requireWorkspace(
  sessionId: string,
  workspaceId: string,
  context?: FolderWorkspace,
) {
  if (context) {
    if (context.agentOnly && context.fileScope !== 'agent') {
      throw new Error(
        context.agentHome
          ? 'No project workspace. Use agent:// for personal files.'
          : 'No project workspace.',
      )
    }
    if (context.workspaceId !== workspaceId || !context.sources?.length)
      throw new Error('Invalid folder workspace context')

    const roots = await Promise.all(
      context.sources.map(async (source) => {
        const root = await realpath(source.path)
        if (root !== source.path || !(await stat(root)).isDirectory())
          throw new Error(`Source directory changed: ${source.path}`)
        return root
      }),
    )
    if (roots[0] !== context.path)
      throw new Error('Primary source does not match the workspace')

    if (context.agentHome) {
      await assertPlainPath(context.agentHome.path)
      if (
        (await realpath(context.agentHome.path)) !== context.agentHome.path ||
        !(await stat(context.agentHome.path)).isDirectory()
      ) {
        throw new Error('Personal folder changed')
      }
    }
    return {
      workspaceId,
      sessionId,
      root: roots[0]!,
      roots: [
        ...new Set([
          ...roots,
          ...(context.agentHome && context.fileScope === 'agent'
            ? [await realpath(context.agentHome.path)]
            : []),
        ]),
      ],
      grantRoot: context.approvalRoot ?? roots[0]!,
      label: context.label,
    }
  }

  throw new Error('Workspace is not configured for this session')
}
