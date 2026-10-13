import { transitionActive } from '@sb/core/workspace/transition'

const locks = new Map<string, string>()
const mutating = new Map<string, number>()
const active = new Map<string, number>()

export async function lockAgent(agentId: string, token: string) {
  if (!transitionActive(token))
    throw new Error('Personal folder operation expired')
  if (locks.get(agentId) === token) {
    locks.set(agentId, token)
    return
  }

  const { hasRunningAgentJobs } = await import('../shell/registry')
  const busy =
    transitionActive(locks.get(agentId)) ||
    active.get(agentId) ||
    mutating.get(agentId) ||
    hasRunningAgentJobs(agentId)

  if (busy) {
    throw new Error(
      'Wait for this agent’s filesystem operations and shell jobs to finish',
    )
  }
  locks.set(agentId, token)
}

export function unlockAgent(agentId: string, token: string) {
  if (locks.get(agentId) === token) {
    locks.delete(agentId)
  }
}

/** Serializes home transitions against all sessions using the same agent home. */
export async function withAgentFiles<T>(
  agentId: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!agentId) return operation()
  if (transitionActive(locks.get(agentId)) || mutating.get(agentId))
    throw new Error('Personal folder is being updated')

  active.set(agentId, (active.get(agentId) ?? 0) + 1)
  try {
    return await operation()
  } finally {
    const count = (active.get(agentId) ?? 1) - 1
    if (count) active.set(agentId, count)
    else active.delete(agentId)
  }
}

/** Keeps long streamed copies fenced even if the backend's transition lease expires. */
export async function withAgentMutation<T>(
  agentId: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!agentId) return operation()
  mutating.set(agentId, (mutating.get(agentId) ?? 0) + 1)
  try {
    return await operation()
  } finally {
    const count = (mutating.get(agentId) ?? 1) - 1
    if (count) mutating.set(agentId, count)
    else mutating.delete(agentId)
  }
}
