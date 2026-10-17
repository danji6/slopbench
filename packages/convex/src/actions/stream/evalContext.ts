'use node'

import type { EvalContext } from '@sb/core/interpreter/types'
import { parseModelReference } from '@sb/core/model-reference'
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
  const workspace = session.workspace
  const workDirs =
    workspace && !workspace.agentOnly
      ? (workspace.sources?.map((source) => source.path) ?? [workspace.path])
      : undefined

  return {
    assistant: agent.name,
    user: toOptionalName(invokerSettings?.displayName),
    owner: toDisplayName(ownerSettings?.displayName),
    modelId: session.model
      ? parseModelReference(session.model.id).modelId
      : undefined,
    modelName:
      session.model?.label ??
      (session.model
        ? parseModelReference(session.model.id).modelId
        : undefined),
    tools: toolNames,
    isAdmin: minRole(invoker.role, 'admin'),
    userCount,
    agentCount,
    workDir: workspace && !workspace.agentOnly ? workspace.path : undefined,
    agentDir: session.workspace?.agentHome?.path,
    workDirs,
  }
}
