'use node'

import type { EvalContext } from '@sb/core/interpreter/types'
import { toDisplayName, toOptionalName } from '@sb/core/utils/names'

import type { Doc } from '../../_generated/dataModel'
import { minRole } from '../../lib/roles'
import type { Session } from '../../types'

type EvalContextInput = {
  agent: Doc<'agents'>
  invoker: Doc<'users'>
  invokerSettings: Doc<'settings'> | null
  owner: Doc<'users'>
  ownerSettings: Doc<'settings'> | null
  session: Session
  userCount: number
  agentCount: number
  toolNames: string[]
}

/**
 * Builds the interpreter context shared by prompt and message evaluation, so
 * every script resolves against the same variables regardless of where it runs.
 */
export function buildEvalContext({
  agent,
  invoker,
  invokerSettings,
  ownerSettings,
  session,
  userCount,
  agentCount,
  toolNames,
}: EvalContextInput): EvalContext {
  const workDirs = session.workspace
    ? [
        ...new Set([
          ...(session.workspace.sources?.map((source) => source.path) ?? [
            session.workspace.path,
          ]),
          ...(session.workspace.agentHome
            ? [session.workspace.agentHome.path]
            : []),
        ]),
      ]
    : undefined

  return {
    assistant: agent.name,
    user: toOptionalName(invokerSettings?.displayName),
    owner: toDisplayName(ownerSettings?.displayName),
    modelId: session.model?.id,
    modelName: session.model?.label ?? session.model?.id,
    tools: toolNames,
    isAdmin: minRole(invoker.role, 'admin'),
    userCount,
    agentCount,
    workDir: session.workspace?.path,
    agentDir: session.workspace?.agentHome?.path,
    workDirs,
  }
}
