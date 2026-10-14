import {
  agentFileOperationSchema,
  completeAgentFileArgsValidator,
  copySkillAssignmentsArgsValidator,
  failAgentFileArgsValidator,
  invalidateAgentHomeArgsValidator,
  operationAttemptArgsValidator,
  reserveHomeArgsValidator,
} from '@sb/convex/validators/fileOperations'
import {
  continueSkillImportArgsValidator,
  finishSkillImportArgsValidator,
  prepareSkillImportArgsValidator,
} from '@sb/convex/validators/skills'
import { expect, test } from 'bun:test'
import { validate } from 'convex-helpers/validators'

const common = {
  ownerId: 'owner',
  attempt: 1,
  updatedAt: 0,
  state: { phase: 'queued' },
}

const operations = [
  { ...common, kind: 'ensure', agentId: 'agent', homeId: 'home' },
  {
    ...common,
    kind: 'home',
    agentId: 'agent',
    homeId: 'home',
    destination: '/new',
    copyFiles: false,
  },
  {
    ...common,
    kind: 'detach',
    agentId: 'agent',
    homeId: 'home',
    removeFolder: false,
  },
  {
    ...common,
    kind: 'duplicate',
    agentId: 'agent',
    homeId: 'home',
    duplicateId: 'duplicate',
    destinationHomeId: 'target',
  },
  {
    ...common,
    kind: 'assign',
    agentId: 'agent',
    homeId: 'home',
    skillId: 'skill',
  },
  {
    ...common,
    kind: 'delete-assigned',
    agentId: 'agent',
    homeId: 'home',
    skillId: 'skill',
    assignmentId: 'assignment',
  },
  { ...common, kind: 'delete-library', skillId: 'skill' },
  { ...common, kind: 'delete-home', homeId: 'home' },
  {
    ...common,
    kind: 'install',
    source: { kind: 'directory', path: '/skills' },
    progress: { cursor: 0, summary: { installed: 0, skipped: 0, failed: 0 } },
  },
]

test.each(operations)(
  'stored $kind operations require their command fields',
  (op) => {
    expect(validate(agentFileOperationSchema, op)).toBe(true)
    for (const key of Object.keys(op)) {
      const missing = { ...op } as Record<string, unknown>
      delete missing[key]
      expect(validate(agentFileOperationSchema, missing)).toBe(false)
    }
    expect(
      validate(agentFileOperationSchema, { ...op, finishingHome: true }),
    ).toBe(false)
  },
)

test('commands reject unsupported finalization phases and unpaired destination reservations', () => {
  for (const op of operations) {
    expect(
      validate(agentFileOperationSchema, {
        ...op,
        state: { phase: 'invalidating' },
      }),
    ).toBe(['home', 'detach'].includes(op.kind))
    expect(
      validate(agentFileOperationSchema, {
        ...op,
        state: { phase: 'cleaning' },
      }),
    ).toBe(op.kind === 'delete-home')
  }
  expect(
    validate(agentFileOperationSchema, {
      ...operations[1],
      reservation: { homeId: 'target' },
    }),
  ).toBe(false)
})

test('every worker and callback validator requires an explicit attempt', () => {
  const validators = [
    operationAttemptArgsValidator,
    completeAgentFileArgsValidator,
    invalidateAgentHomeArgsValidator,
    reserveHomeArgsValidator,
    copySkillAssignmentsArgsValidator,
    failAgentFileArgsValidator,
    continueSkillImportArgsValidator,
    finishSkillImportArgsValidator,
    prepareSkillImportArgsValidator,
  ]
  for (const validator of validators) {
    expect(validator.fields.attempt.isOptional).toBe('required')
    expect(validate(validator, { operationId: 'operation' })).toBe(false)
  }
  expect(
    validate(completeAgentFileArgsValidator, {
      operationId: 'operation',
      attempt: 1,
      result: { kind: 'home' },
    }),
  ).toBe(false)
  expect(
    validate(completeAgentFileArgsValidator, {
      operationId: 'operation',
      attempt: 1,
      result: { kind: 'home', path: '/new' },
    }),
  ).toBe(true)
  expect(
    validate(invalidateAgentHomeArgsValidator, {
      operationId: 'operation',
      attempt: 1,
      cursor: null,
      previousPath: '/untrusted',
    }),
  ).toBe(false)
})
