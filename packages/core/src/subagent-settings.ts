import type { AgentSubagentOverride } from './types/agents'

/** Keeps the last setting for each agent and omits entries that inherit everything. */
export function normalizeSubagentOverrides<AgentId extends string>(
  overrides: AgentSubagentOverride<AgentId>[] = [],
): AgentSubagentOverride<AgentId>[] {
  const latest = new Map(overrides.map((entry) => [entry.agentId, entry]))
  return [...latest.values()].flatMap(
    ({ agentId, modelId, reasoningEffort }) => {
      const model = modelId?.trim()
      if (!model && !reasoningEffort) return []
      return [
        {
          agentId,
          ...(model && { modelId: model }),
          ...(reasoningEffort && { reasoningEffort }),
        },
      ]
    },
  )
}
