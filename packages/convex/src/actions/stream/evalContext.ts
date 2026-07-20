'use node'

import type { EvalContext } from '@sb/core/interpreter/types'

import type { Doc } from '../../_generated/dataModel'
import { minRole } from '../../lib/roles'

type EvalContextInput = {
  agent: Doc<'agents'>
  invoker: Doc<'users'>
  invokerSettings: Doc<'settings'> | null
  owner: Doc<'users'>
  ownerSettings: Doc<'settings'> | null
  session: Doc<'sessions'>
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
  return {
    assistant: agent.name,
    user: invokerSettings?.displayName,
    owner: ownerSettings?.displayName ?? 'User',
    tools: toolNames,
    isAdmin: minRole(invoker.role, 'admin'),
    userCount,
    agentCount,
    workDir: session.workspace?.path,
  }
}
