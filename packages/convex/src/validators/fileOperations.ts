import { v } from 'convex/values'

export const ensureHomeArgsValidator = v.object({
  kind: v.literal('ensure'),
  agentId: v.id('agents'),
})

export const detachHomeArgsValidator = v.object({
  kind: v.literal('detach'),
  agentId: v.id('agents'),
  removeFolder: v.optional(v.boolean()),
})

export const installDirectoryArgsValidator = v.object({
  kind: v.literal('install'),
  source: v.string(),
})

export const installUploadArgsValidator = v.object({
  kind: v.literal('install'),
  storageId: v.id('_storage'),
})

export const assignSkillArgsValidator = v.object({
  kind: v.literal('assign'),
  agentId: v.id('agents'),
  skillId: v.id('skills'),
})

export const deleteAssignedSkillArgsValidator = v.object({
  kind: v.literal('delete-assigned'),
  agentId: v.id('agents'),
  assignmentId: v.id('agentSkills'),
})

export const deleteLibrarySkillArgsValidator = v.object({
  kind: v.literal('delete-library'),
  skillId: v.id('skills'),
})

export const changeHomeArgsValidator = v.object({
  kind: v.literal('home'),
  agentId: v.id('agents'),
  destination: v.string(),
  copyFiles: v.boolean(),
})

export const duplicateHomeArgsValidator = v.object({
  kind: v.literal('duplicate'),
  agentId: v.id('agents'),
  duplicateId: v.id('agents'),
})

export const fileOperationArgsValidator = v.union(
  ensureHomeArgsValidator,
  detachHomeArgsValidator,
  installDirectoryArgsValidator,
  installUploadArgsValidator,
  assignSkillArgsValidator,
  deleteAssignedSkillArgsValidator,
  deleteLibrarySkillArgsValidator,
  changeHomeArgsValidator,
  duplicateHomeArgsValidator,
)

/** Keeps the command union inside the object required by Convex function arguments. */
export const startFileOperationArgsValidator = v.object({
  operation: fileOperationArgsValidator,
})

/** Identifies one scheduled execution and all of its finalization pages. */
export const operationAttemptArgsValidator = v.object({
  operationId: v.id('agentFileOperations'),
  attempt: v.number(),
})

const attemptFields = operationAttemptArgsValidator.fields

export const operationResultValidator = v.union(
  v.object({ kind: v.literal('ensure'), path: v.string() }),
  v.object({ kind: v.literal('home'), path: v.string() }),
  v.object({ kind: v.literal('duplicate'), path: v.string() }),
  v.object({ kind: v.literal('assign'), path: v.string() }),
  v.object({ kind: v.literal('delete-assigned') }),
  v.object({ kind: v.literal('delete-library') }),
  v.object({ kind: v.literal('delete-home') }),
  v.object({ kind: v.literal('detach') }),
  v.object({ kind: v.literal('install') }),
)

export const completeAgentFileArgsValidator = v.object({
  ...attemptFields,
  result: operationResultValidator,
})

export const invalidateAgentHomeArgsValidator = v.object({
  ...attemptFields,
  cursor: v.union(v.string(), v.null()),
})

export const failAgentFileArgsValidator = v.object({
  ...attemptFields,
  message: v.string(),
})

export const reserveHomeArgsValidator = v.object({
  ...attemptFields,
  path: v.string(),
  insideData: v.boolean(),
})

export const copySkillAssignmentsArgsValidator = v.object({
  ...attemptFields,
  ids: v.array(v.id('agentSkills')),
})

const queuedState = v.object({ phase: v.literal('queued') })

const executingState = v.object({ phase: v.literal('executing') })

const doneState = v.object({ phase: v.literal('done') })

const failedState = v.object({ phase: v.literal('failed'), error: v.string() })

const invalidatingState = v.object({
  phase: v.literal('invalidating'),
  previousPath: v.optional(v.string()),
})

const cleaningState = v.object({ phase: v.literal('cleaning') })

const executionState = v.union(
  queuedState,
  executingState,
  doneState,
  failedState,
)

const homeState = v.union(executionState, invalidatingState)

const removalState = v.union(executionState, cleaningState)

const detachState = v.union(homeState, cleaningState)

const commonFields = {
  ownerId: v.id('users'),
  attempt: v.number(),
  updatedAt: v.number(),
}

const agentFields = { agentId: v.id('agents'), homeId: v.id('agentHomes') }

const destinationReservation = v.object({
  homeId: v.id('agentHomes'),
  joined: v.boolean(),
})

const importSource = v.union(
  v.object({ kind: v.literal('directory'), path: v.string() }),
  v.object({
    kind: v.literal('upload'),
    storageId: v.id('_storage'),
    ticket: v.string(),
  }),
)

const importProgress = v.object({
  cursor: v.number(),
  summary: v.object({
    installed: v.number(),
    skipped: v.number(),
    failed: v.number(),
  }),
  skillId: v.optional(v.id('skills')),
  error: v.optional(v.string()),
})

/** Requires each command's targets and permits only its supported lifecycle phases. */
export const agentFileOperationSchema = v.union(
  v.object({
    ...commonFields,
    ...agentFields,
    kind: v.literal('ensure'),
    state: executionState,
    reservation: v.optional(destinationReservation),
  }),
  v.object({
    ...commonFields,
    ...agentFields,
    kind: v.literal('home'),
    destination: v.string(),
    copyFiles: v.boolean(),
    state: homeState,
    reservation: v.optional(destinationReservation),
  }),
  v.object({
    ...commonFields,
    ...agentFields,
    kind: v.literal('detach'),
    removeFolder: v.literal(true),
    state: detachState,
  }),
  v.object({
    ...commonFields,
    ...agentFields,
    kind: v.literal('detach'),
    removeFolder: v.literal(false),
    state: homeState,
  }),
  v.object({
    ...commonFields,
    ...agentFields,
    kind: v.literal('duplicate'),
    duplicateId: v.id('agents'),
    destinationHomeId: v.id('agentHomes'),
    state: executionState,
  }),
  v.object({
    ...commonFields,
    ...agentFields,
    kind: v.literal('assign'),
    skillId: v.id('skills'),
    state: executionState,
  }),
  v.object({
    ...commonFields,
    ...agentFields,
    kind: v.literal('delete-assigned'),
    assignmentId: v.id('agentSkills'),
    skillId: v.id('skills'),
    state: executionState,
  }),
  v.object({
    ...commonFields,
    kind: v.literal('delete-library'),
    skillId: v.id('skills'),
    state: executionState,
  }),
  v.object({
    ...commonFields,
    kind: v.literal('delete-home'),
    homeId: v.id('agentHomes'),
    state: removalState,
  }),
  v.object({
    ...commonFields,
    kind: v.literal('install'),
    source: importSource,
    progress: importProgress,
    state: executionState,
  }),
)
