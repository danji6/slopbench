import type { AgentHome } from '../skills/types'
import type { FolderWorkspace } from '../types/workspace'

export type FileScope = 'workspace' | 'agent'

/** Adds an agent home without changing the project's path or ordered source authority. */
export function withAgentHome(
  project: FolderWorkspace | undefined,
  home: AgentHome,
): FolderWorkspace {
  return project
    ? { ...project, agentHome: home }
    : {
        workspaceId: `agent:${home.agentId}`,
        path: home.path,
        label: 'Personal folder',
        sources: [
          { id: home.agentId, path: home.path, label: 'Personal folder' },
        ],
        agentHome: home,
        agentOnly: true,
      }
}

/** Keeps approval entries relative to their original base when a tool selects the home. */
export function selectFileWorkspace(
  workspace: FolderWorkspace,
  scope?: FileScope,
): FolderWorkspace {
  if (scope === 'workspace' && workspace.agentOnly) {
    throw new Error('This session has no project workspace')
  }
  if (scope !== 'agent') return workspace
  const home = workspace.agentHome
  if (!home) throw new Error('Personal folder is not available')
  return {
    ...workspace,
    approvalRoot: workspace.approvalRoot ?? workspace.path,
    path: home.path,
    sources: [
      { id: home.agentId, path: home.path, label: 'Personal folder' },
      ...(workspace.sources ?? []).filter(
        (source) => source.path !== home.path,
      ),
    ],
  }
}

/** Identifies a relative file reference without depending on the browser's host OS. */
export function isRelativeFilePath(value: string): boolean {
  return !/^(?:[\\/]|[a-z]:[\\/])/i.test(value)
}
