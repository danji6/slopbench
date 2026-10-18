import type { AgentHome } from '../skills/types'
import type { FolderWorkspace } from '../types/workspace'
import { parseScopedPath } from './scoped-path'

export type { FileScope } from './scoped-path'

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
  filePath = 'workspace://',
): FolderWorkspace {
  const { scope, path } = parseScopedPath(filePath)
  if (scope !== 'agent' && workspace.agentOnly) {
    throw new Error(
      workspace.agentHome
        ? 'This session has no project workspace. Use agent:// for personal files.'
        : 'This session has no project workspace.',
    )
  }

  assertPersonalScope(workspace, path, scope)
  if (scope !== 'agent') return { ...workspace, fileScope: 'workspace' }

  const home = workspace.agentHome
  if (!home) throw new Error('Personal folder is not available')

  return {
    ...workspace,
    fileScope: 'agent',
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
  return !/^(?:[\\/]|[a-z]:[\\/]|[a-z][a-z\d+.-]*:\/\/)/i.test(value)
}

/** Requires explicit home selection even when a tool supplies an absolute path. */
export function assertPersonalScope(
  workspace: FolderWorkspace | undefined,
  filePath?: string,
  scope = workspace?.fileScope,
) {
  if (!workspace?.agentHome || !filePath || scope === 'agent') return
  const target = normalizePath(
    isRelativeFilePath(filePath) ? `${workspace.path}/${filePath}` : filePath,
  )
  const home = normalizePath(workspace.agentHome.path)
  if (target === home || target.startsWith(`${home}/`))
    throw new Error('Personal files require an agent:// path')
}

function normalizePath(value: string) {
  const normalized = value.replace(/\\/g, '/')
  const parts: string[] = []
  for (const part of normalized.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  const result = parts.join('/')
  return /^[a-z]:/i.test(result) ? result.toLowerCase() : result
}
