import { v } from 'convex/values'

export const folderSourceValidator = v.object({
  id: v.string(),
  path: v.string(),
  label: v.string(),
  discoverIntegrations: v.optional(v.boolean()),
  discoverSkills: v.optional(v.boolean()),
})

export const workspaceRefValidator = v.object({
  /** The personal folder assigned to the active agent, when available. */
  agentHome: v.optional(
    v.object({
      /** Owner of the personal folder. */
      ownerId: v.string(),
      /** Shared home identity used to coordinate filesystem access. */
      homeId: v.optional(v.string()),
      /** Original agent identity used to locate a managed folder after sharing. */
      originAgentId: v.optional(v.string()),
      /** Active agent accessing the personal folder. */
      agentId: v.string(),
      /** Absolute personal folder path. */
      path: v.string(),
      /** Shared content revision used to invalidate stale context. */
      revision: v.number(),
    }),
  ),
  /** True when this context has only a personal folder and no project workspace. */
  agentOnly: v.optional(v.boolean()),
  /** The scope explicitly selected for this tool invocation; omitted means workspace. */
  fileScope: v.optional(v.union(v.literal('workspace'), v.literal('agent'))),
  /** The original workspace base used to resolve relative path approvals. */
  approvalRoot: v.optional(v.string()),
  /** Ordered project sources, or the selected personal root for agent scope. */
  sources: v.optional(v.array(folderSourceValidator)),
  /** The revision of the project folder’s source configuration. */
  revision: v.optional(v.number()),
  /** The session folder that supplies the project workspace. */
  folderId: v.optional(v.id('sessionFolders')),
  /** Stable identity of the effective workspace. */
  workspaceId: v.string(),
  /** Human-readable name of the effective workspace. */
  label: v.string(),
  /** Absolute primary root of the effective workspace. */
  path: v.string(),
})
