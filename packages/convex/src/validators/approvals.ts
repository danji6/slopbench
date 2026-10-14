import { v } from 'convex/values'

export const approvalModeValidator = v.union(
  v.literal('ask'),
  v.literal('unrestricted'),
)

export const toolApprovalsValidator = v.object({
  /** Whether unsafe tools will require user approval. */
  mode: v.optional(approvalModeValidator),
  /** Tool names auto-approved for the whole session. */
  tools: v.optional(v.array(v.string())),
  /** Allow-listed shell command patterns. */
  shell: v.optional(v.array(v.string())),
  /** Allow-listed sensitive paths. */
  paths: v.optional(v.array(v.string())),
})

export const rememberScopeValidator = v.union(
  v.literal('patterns'),
  v.literal('paths'),
)
