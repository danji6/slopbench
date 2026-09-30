import {
  defaultModelReasoning,
  normalizeReasoningEffort,
} from '@sb/core/model-reasoning'

import type { Doc } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import type { Session } from '../../types'
import type {
  AgentSubagentOverride,
  ModelSelection,
  ReasoningEffort,
} from '../../types'
import { findModelSelection } from '../provider/providers'
import { resolve as resolveProviders } from '../providers'

export type SubagentModelSettings = {
  model?: ModelSelection
  reasoningEffort?: string
}

export type ResolveSubagentModelArgs = {
  parent: Doc<'agents'> | null
  session: Session
  agent: Doc<'agents'>
}

export type ResolveSubagentModelResult =
  | { settings: SubagentModelSettings; error?: never }
  | { error: string; settings?: never }

/** Resolves spawn-time settings without changing the parent or existing children. */
export async function resolveSubagentModel(
  ctx: QueryCtx,
  { parent, session, agent }: ResolveSubagentModelArgs,
): Promise<ResolveSubagentModelResult> {
  const override = parent?.subAgents?.overrides?.find(
    (entry) => entry.agentId === agent._id,
  )
  let model = session.model
  if (override?.modelId) {
    const providers = await resolveProviders(ctx, agent.ownerId)
    const selected = findModelSelection(
      providers.filter((provider) => provider.enabled),
      override.modelId,
    )
    if (!selected) {
      return {
        error: `Cannot spawn sub-agent "${agent.name}": model "${override.modelId}" is unavailable. Select an enabled model in the parent agent's sub-agent settings.`,
      }
    }
    model = selected
  }
  return { settings: resolveReasoning(session, model, override) }
}

function resolveReasoning(
  session: Session,
  model: ModelSelection | undefined,
  override?: AgentSubagentOverride,
): SubagentModelSettings {
  // Preserve legacy inheritance exactly when neither setting is overridden.
  if (!override) return { model, reasoningEffort: session.reasoningEffort }
  const reasoningEffort = normalizeReasoningEffort(
    override.reasoningEffort ??
      (session.reasoningEffort as ReasoningEffort | undefined),
    model?.reasoning ?? defaultModelReasoning(),
  )
  return { model, reasoningEffort }
}
