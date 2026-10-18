import type { Id } from '@sb/convex/_generated/dataModel'
import type { MutationCtx } from '@sb/convex/_generated/server'
import { start as startPublicOperation } from '@sb/convex/model/skills/endpoints'
import { validateOperationArgs } from '@sb/convex/model/skills/operationArgs'
import { start } from '@sb/convex/model/skills/operations'
import { start as startMutation } from '@sb/convex/skills'
import type { FileOperationArgs } from '@sb/convex/types'
import {
  fileOperationArgsValidator,
  startFileOperationArgsValidator,
} from '@sb/convex/validators/fileOperations'
import { expect, test } from 'bun:test'
import { validate } from 'convex-helpers/validators'
import type { Infer } from 'convex/values'

import { skillsDatabase } from '../helpers/skills-db'

type MutationRuntime = {
  exportArgs(): string
  _handler: (
    ctx: MutationCtx,
    args: Infer<typeof startFileOperationArgsValidator>,
  ) => ReturnType<typeof startPublicOperation>
}

// Convex exposes these hooks at runtime but omits them from its public types.
const mutationRuntime = startMutation as unknown as MutationRuntime
const agentId = 'agent' as Id<'agents'>
const skillId = 'skill' as Id<'skills'>
const assignmentId = 'assignment' as Id<'agentSkills'>
const duplicateId = 'duplicate' as Id<'agents'>
const storageId = 'upload' as Id<'_storage'>

test('the registered mutation exports an object with the command union inside it', () => {
  const args = JSON.parse(mutationRuntime.exportArgs())
  expect(args.type).toBe('object')
  expect(args.value.operation.fieldType.type).toBe('union')
  expect(args.value.operation.fieldType.value).toHaveLength(
    fileOperationArgsValidator.members.length,
  )
  expect(args.value.operation.optional).toBe(false)
})

test('the registered mutation unwraps the command before reserving filesystem work', async () => {
  const { ctx, rows } = skillsDatabase()
  rows('users').push({ _id: ctx.userId, subject: ctx.subject, role: 'admin' })
  rows('agents').push({ _id: agentId, ownerId: ctx.userId, name: 'Agent' })

  const id = await mutationRuntime._handler(
    {
      ...ctx,
      auth: {
        getUserIdentity: async () => ({
          subject: ctx.subject,
          tokenIdentifier: 'fixture:owner',
          issuer: 'fixture',
        }),
      },
    },
    { operation: { kind: 'ensure', agentId } },
  )

  expect(rows('agentFileOperations')).toMatchObject([
    {
      _id: id,
      kind: 'ensure',
      agentId,
      ownerId: ctx.userId,
      state: { phase: 'queued' },
    },
  ])
})

test('command contracts accept each supported operation and both import sources', () => {
  const commands: FileOperationArgs[] = [
    { kind: 'ensure', agentId },
    { kind: 'detach', agentId },
    { kind: 'detach', agentId, removeFolder: true },
    { kind: 'install', source: '/skills' },
    { kind: 'install', storageId },
    { kind: 'assign', agentId, skillId },
    { kind: 'delete-assigned', agentId, assignmentId },
    { kind: 'delete-library', mode: 'keep-copies', skillId },
    { kind: 'home', agentId, destination: '/new', copyFiles: false },
    { kind: 'duplicate', agentId, duplicateId },
  ]

  for (const command of commands) {
    expect(validate(fileOperationArgsValidator, command)).toBe(true)
    expect(
      validate(startFileOperationArgsValidator, { operation: command }),
    ).toBe(true)
    expect(() => validateOperationArgs(command)).not.toThrow()
  }
})

test('malformed commands are rejected before reserving any resources', async () => {
  const malformed: unknown[] = [
    { kind: 'delete-home' },
    { kind: 'ensure' },
    { kind: 'detach' },
    { kind: 'assign', skillId },
    { kind: 'assign', agentId },
    { kind: 'delete-assigned', assignmentId },
    { kind: 'delete-assigned', agentId },
    { kind: 'delete-library' },
    { kind: 'delete-library', skillId },
    { kind: 'delete-library', skillId, mode: 'invalid' },
    { kind: 'duplicate', agentId },
    { kind: 'duplicate', duplicateId },
    { kind: 'home', agentId, destination: '/new' },
    { kind: 'home', agentId, copyFiles: false },
    { kind: 'install' },
    { kind: 'install', source: '/skills', storageId },
    { kind: 'ensure', agentId, removeFolder: true },
    { kind: 'delete-library', mode: 'keep-copies', skillId, assignmentId },
  ]
  const { ctx, rows, scheduled } = skillsDatabase()

  for (const command of malformed) {
    expect(validate(fileOperationArgsValidator, command)).toBe(false)
    expect(
      validate(startFileOperationArgsValidator, { operation: command }),
    ).toBe(false)
    // Simulate callers that bypass TypeScript, as runtime validation must protect them.
    await expect(start(ctx, command as FileOperationArgs)).rejects.toThrow(
      'Invalid arguments',
    )
  }
  expect(rows('agentHomes')).toHaveLength(0)
  expect(rows('agentFileOperations')).toHaveLength(0)
  expect(scheduled).toHaveLength(0)
})

test('required command fields are also checked by TypeScript', () => {
  // @ts-expect-error Assign commands require a skill.
  const assign: FileOperationArgs = { kind: 'assign', agentId }
  // @ts-expect-error Home commands require an explicit copy choice.
  const home: FileOperationArgs = { kind: 'home', agentId, destination: '/new' }
  // @ts-expect-error Duplicate commands require a destination agent.
  const duplicate: FileOperationArgs = { kind: 'duplicate', agentId }

  for (const command of [assign, home, duplicate]) {
    expect(validate(fileOperationArgsValidator, command)).toBe(false)
  }
})

test('string content rules still reject blank directories', () => {
  expect(() =>
    validateOperationArgs({
      kind: 'home',
      agentId,
      destination: '  ',
      copyFiles: true,
    }),
  ).toThrow('Choose a destination directory')
  expect(() =>
    validateOperationArgs({ kind: 'install', source: '  ' }),
  ).toThrow('Choose a local directory')
})

test('internal-only operation kinds remain unavailable through the public entry point', () => {
  const { ctx, rows } = skillsDatabase()
  expect(() =>
    startPublicOperation(ctx, { kind: 'duplicate', agentId, duplicateId }),
  ).toThrow('agent duplication command')
  expect(rows('agentFileOperations')).toHaveLength(0)
})
