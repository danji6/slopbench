import { paginationOptsValidator } from 'convex/server'
import { v } from 'convex/values'

import { approvalModeValidator, toolApprovalsValidator } from './approvals'
import { queuedCommandValidator } from './commands'
import { promptItemValidator } from './prompts'
import { modelSelectionValidator, tokenUsageValidator } from './providers'
import { sessionArchiveValidator } from './sessionArchives'
import { sessionModeValidator } from './sessionModes'
import { toolManifestValidator } from './tools'

export const listSessionsArgsValidator = v.object({
  paginationOpts: paginationOptsValidator,
  groupKey: v.optional(v.string()),
  search: v.optional(v.string()),
  showHidden: v.optional(v.boolean()),
})

export const sessionSettingsValidator = v.object({
  disabled: v.optional(v.boolean()),
  slowModeMs: v.optional(v.number()), // minimum gap between a user's sends
  agentDebounceMs: v.optional(v.number()), // delay before the agent responds
  passiveSend: v.optional(v.boolean()), // invoking the agent requires a modifier
})

/** Prompt interpreter variables for one session. */
export const environmentValidator = v.record(v.string(), v.any())

/** Presentation choices that affect the provider's existing history. */
export const historyPresentationValidator = v.object({
  maskOtherAgents: v.boolean(),
  shareUserDisplayNames: v.boolean(),
  shareAgentDisplayNames: v.boolean(),
})

/** Marks a session as a sub-agent child of another session's turn. */
export const sessionParentValidator = v.object({
  sessionId: v.id('sessions'),
  streamId: v.id('streams'),
  toolCallId: v.string(),
  agentId: v.id('agents'), // parent agent, for the back-link label
})

export const saveSessionCacheArgsValidator = v.object({
  filesystemAccess: v.optional(v.boolean()),
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  items: v.optional(v.array(promptItemValidator)),
  tools: v.optional(toolManifestValidator),
  historyPresentation: v.optional(historyPresentationValidator),
})

export const createSessionArgsValidator = v.object({
  activeAgentId: v.optional(v.id('agents')),
  folderId: v.optional(v.id('sessionFolders')),
  /** Only meaningful together with workspaceRoot. */
  mode: v.optional(sessionModeValidator),
  /** Only meaningful together with workspaceRoot. */
  approvalMode: v.optional(approvalModeValidator),
})

export const updateSessionArgsValidator = v.object({
  sessionId: v.id('sessions'),
  title: v.optional(v.string()),
  activeAgentId: v.optional(v.union(v.id('agents'), v.null())),
  settings: v.optional(sessionSettingsValidator),
})

export const importSessionArgsValidator = v.object({
  payload: sessionArchiveValidator,
  subject: v.string(),
  avatars: v.record(v.string(), v.id('_storage')),
})

/** A conversation and its settings. */
export const sessionSchema = v.object({
  ownerId: v.id('users'),
  title: v.optional(v.string()),
  activeAgentId: v.optional(v.id('agents')),
  mode: v.optional(sessionModeValidator),
  /** Mode the transcript states. */
  announcedMode: v.optional(sessionModeValidator),
  settings: v.optional(sessionSettingsValidator),
  /** Selected model, resolved against the active agent owner's providers. */
  model: v.optional(modelSelectionValidator),
  reasoningEffort: v.optional(v.string()),
  folderId: v.optional(v.id('sessionFolders')),
  contextLock: v.optional(v.string()),
  parent: v.optional(sessionParentValidator),
  lastMessageAt: v.optional(v.number()),
  lastMessagePreview: v.optional(v.string()),
  /** Title fallback. */
  firstMessagePreview: v.optional(v.string()),
})

/**
 * A session's frequently changing state. It lives outside the session doc
 * because every one of these fields is rewritten during stream turns and would
 * otherwise make client session subscriptions unstable.
 */
export const sessionStateSchema = v.object({
  pathApprovalRevision: v.optional(v.string()),
  sessionId: v.id('sessions'),
  environment: v.optional(environmentValidator),
  toolApprovals: v.optional(toolApprovalsValidator),
  /** Successful provider steps completed by invoke streams. */
  stepCount: v.number(),
  /** (reminderId, stepCount) at last injection, or baseline when first seen. */
  reminderState: v.optional(v.record(v.string(), v.number())),
  /** Deferred (slash) commands. */
  commandQueue: v.optional(v.array(queuedCommandValidator)),
  usage: v.optional(tokenUsageValidator),
  /** Last provider request/response body. */
  log: v.optional(v.id('_storage')),
  updatedAt: v.number(),
})

/** A user’s membership and personal listing state for a session. */
export const userSessionSchema = v.object({
  /** Personal organization for joined sessions. */
  folderId: v.optional(v.id('sessionFolders')),
  groupKey: v.optional(v.string()),
  pinned: v.optional(v.boolean()),
  sessionId: v.id('sessions'),
  userId: v.id('users'),
  role: v.union(v.literal('owner'), v.literal('member')),
  lastMessageAt: v.optional(v.number()),
  /** This user's last send, for slow mode. */
  lastSendAt: v.optional(v.number()),
  /** Session title denormalized for search. */
  title: v.optional(v.string()),
  /** Always excluded from listing (e.g. sub-agent child sessions). */
  hidden: v.optional(v.boolean()),
  /** True when the user manually hid this session. */
  userHidden: v.optional(v.boolean()),
})

/** A revocable invitation to a session. */
export const sessionShareSchema = v.object({
  sessionId: v.id('sessions'),
  tokenHash: v.string(),
  createdBy: v.id('users'),
  revokedAt: v.optional(v.number()),
})

/** An agent’s membership in a session. */
export const sessionAgentSchema = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  addedBy: v.id('users'),
})

/** The captured prompt and tool configuration for a session and agent. */
export const sessionCacheSchema = v.object({
  historyPresentation: v.optional(historyPresentationValidator),
  homeId: v.optional(v.id('agentHomes')),
  filesystemAccess: v.optional(v.boolean()),
  homeRevision: v.optional(v.number()),
  workspaceRevision: v.optional(v.string()),
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  /** Evaluated invoke prompts for this (session, agent). */
  items: v.array(promptItemValidator),
  /** Tool set shape. Their behavior is kept volatile. */
  tools: v.optional(toolManifestValidator),
  capturedAt: v.number(),
})
