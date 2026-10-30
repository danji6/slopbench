import { v } from 'convex/values'

import { streamExecutionArgsValidator } from './streams'
import { workspaceRefValidator } from './workspaces'

export const changedFileValidator = v.object({
  key: v.string(),
  path: v.string(),
  kind: v.union(
    v.literal('added'),
    v.literal('modified'),
    v.literal('deleted'),
  ),
  additions: v.number(),
  deletions: v.number(),
  binary: v.boolean(),
  truncated: v.boolean(),
})

export const changeStateValidator = v.union(
  v.literal('applied'),
  v.literal('reverted'),
)

export const changePhaseValidator = v.union(
  v.literal('capturing'),
  v.literal('queued'),
  v.literal('ready'),
  v.literal('restoring'),
  v.literal('unavailable'),
  v.literal('empty'),
)

export const changeSetSchema = v.object({
  sessionId: v.id('sessions'),
  agentId: v.id('agents'),
  streamId: v.id('streams'),
  groupId: v.string(),
  root: v.boolean(),
  messageId: v.id('messages'),
  version: v.number(),
  workspace: workspaceRefValidator,
  phase: changePhaseValidator,
  state: changeStateValidator,
  revision: v.number(),
  fileCount: v.number(),
  additions: v.number(),
  deletions: v.number(),
  issues: v.array(v.string()),
  conflicts: v.array(v.string()),
  writersSettled: v.optional(v.boolean()),
  finished: v.optional(v.boolean()),
  error: v.optional(v.string()),
  requestedBy: v.optional(v.id('users')),
  operationId: v.optional(v.string()),
  direction: v.optional(v.union(v.literal('revert'), v.literal('reapply'))),
  settleScheduled: v.optional(v.boolean()),
  checkpointId: v.optional(v.string()),
})

export const changeFileSchema = v.object({
  sessionId: v.id('sessions'),
  changeSetId: v.id('changeSets'),
  file: changedFileValidator,
  diffStorageId: v.id('_storage'),
})

export const prepareChangesArgsValidator = v.object({
  ...streamExecutionArgsValidator.fields,
  workspace: workspaceRefValidator,
})

export const restoreChangesArgsValidator = v.object({
  changeSetId: v.id('changeSets'),
  revision: v.number(),
  direction: v.union(v.literal('revert'), v.literal('reapply')),
})

export const reservePublicationArgsValidator = v.object({
  changeSetId: v.id('changeSets'),
  checkpointId: v.string(),
  late: v.boolean(),
})

export const appendChangesArgsValidator = v.object({
  changeSetId: v.id('changeSets'),
  files: v.array(
    v.object({ file: changedFileValidator, diffStorageId: v.id('_storage') }),
  ),
})

export const publishChangesArgsValidator = v.object({
  changeSetId: v.id('changeSets'),
  fileCount: v.number(),
  additions: v.number(),
  deletions: v.number(),
  issues: v.array(v.string()),
})

export const settleChangesArgsValidator = v.object({
  changeSetId: v.id('changeSets'),
  sequence: v.number(),
})

export const restoreChangesResultValidator = v.object({
  changeSetId: v.id('changeSets'),
  operationId: v.string(),
  state: v.optional(changeStateValidator),
  revision: v.optional(v.number()),
  conflicts: v.optional(v.array(v.string())),
  error: v.optional(v.string()),
})
