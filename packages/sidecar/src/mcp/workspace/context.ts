import type { FolderWorkspace } from '@sb/core/types/workspace'
import { transitionActive } from '@sb/core/workspace/transition'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import { withAgentFiles } from '../../agent-files/access'
import { mcpRegistry } from '../external/registry'
import { expandHome } from './paths'

export const sourceSchema = z.object({
  id: z.string().min(1).max(100),
  path: z.string().min(1),
  label: z.string(),
  discoverSkills: z.boolean().optional(),
})

export const workspaceContextSchema = z.object({
  agentHome: z
    .object({
      ownerId: z.string(),
      homeId: z.string().optional(),
      originAgentId: z.string().optional(),
      agentId: z.string(),
      path: z.string(),
      revision: z.number(),
    })
    .optional(),
  agentOnly: z.boolean().optional(),
  fileScope: z.enum(['workspace', 'agent']).optional(),
  approvalRoot: z.string().optional(),
  workspaceId: z.string(),
  folderId: z.string().optional(),
  revision: z.number().optional(),
  path: z.string(),
  label: z.string(),
  sources: z.array(sourceSchema).optional(),
})

export const validateSourcesSchema = z.object({
  sources: z.array(sourceSchema).max(20),
})

/** Validates and deduplicates source directories, retaining their order. */
export async function validateSources(
  input: z.infer<typeof validateSourcesSchema>,
) {
  const sources: z.infer<typeof sourceSchema>[] = []
  for (const source of input.sources) {
    const root = await realpath(path.resolve(expandHome(source.path)))
    if (!(await stat(root)).isDirectory())
      throw new Error(`Source is not a directory: ${source.path}`)
    if (sources.some((s) => s.path === root)) continue
    if (sources.some((s) => s.id === source.id))
      throw new Error('Source ids must be unique')
    sources.push({
      id: source.id,
      discoverSkills: source.discoverSkills ?? true,
      path: root,
      label: path.basename(root) || root,
    })
  }
  return sources
}

const locks = new Map<string, string>()
const active = new Map<string, number>()
export const lockSchema = z.object({
  sessionIds: z.array(z.string()),
  token: z.string(),
})

export async function lockWorkspaces(input: z.infer<typeof lockSchema>) {
  if (!transitionActive(input.token)) throw new Error('Folder update timed out')
  const { listShellJobs } = await import('../../shell/registry')
  for (const id of input.sessionIds) {
    if (
      transitionActive(locks.get(id)) ||
      active.get(id) ||
      mcpRegistry.hasActivity(id) ||
      listShellJobs(id).some((job) => job.status === 'running')
    ) {
      throw new Error('Wait for shell jobs and filesystem operations to finish')
    }
  }
  for (const id of input.sessionIds) locks.set(id, input.token)
  await mcpRegistry.disconnectSessions(input.sessionIds)
  return { ok: true }
}

export function unlockWorkspaces(input: z.infer<typeof lockSchema>) {
  for (const id of input.sessionIds) {
    if (locks.get(id) === input.token) locks.delete(id)
  }
  return { ok: true }
}

/** Serializes source transitions against the whole filesystem operation. */
export async function withWorkspaceOperation<T>(
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (transitionActive(locks.get(sessionId)))
    throw new Error('Folder sources are being updated')
  active.set(sessionId, (active.get(sessionId) ?? 0) + 1)
  try {
    return await operation()
  } finally {
    const count = (active.get(sessionId) ?? 1) - 1
    if (count) active.set(sessionId, count)
    else active.delete(sessionId)
  }
}

/** Holds personal folder and project transition guards for a filesystem operation. */
export function withFilesystemOperation<T>(
  input: { sessionId: string; workspace?: FolderWorkspace },
  operation: () => Promise<T>,
): Promise<T> {
  const home = input.workspace?.agentHome
  return withAgentFiles(home?.homeId ?? home?.agentId, () =>
    withWorkspaceOperation(input.sessionId, operation),
  )
}
