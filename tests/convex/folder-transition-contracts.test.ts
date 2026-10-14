import { commitPrepared } from '@sb/convex/actions/session/folders'
import { cancel } from '@sb/convex/model/session/folderTransitionLocks'
import { begin, commit } from '@sb/convex/model/session/folderTransitions'
import {
  folderChangeArgs,
  folderCommitArgs,
} from '@sb/convex/validators/folders'
import { expect, spyOn, test } from 'bun:test'
import { validate } from 'convex-helpers/validators'
import { getFunctionName } from 'convex/server'

import { args, cancelArgs, commitArgs, setup } from './session-folder-fixture'

test('folder commands reject missing resources and mixed operations', () => {
  const commands = [
    { kind: 'move-session', sessionId: 's' },
    { kind: 'move-folder', folderId: 'a', parentId: null },
    { kind: 'update-sources', folderId: 'a', sources: [] },
    { kind: 'delete-folder', folderId: 'a' },
  ]
  for (const command of commands)
    expect(validate(folderChangeArgs, { command })).toBe(true)
  for (const command of [
    { kind: 'move-session' },
    { kind: 'move-folder', folderId: 'a' },
    { kind: 'update-sources', folderId: 'a' },
    { kind: 'delete-folder' },
    { kind: 'move-session', sessionId: 's', sources: [] },
    { kind: 'delete-folder', folderId: 'a', sessionId: 's' },
  ])
    expect(validate(folderChangeArgs, { command })).toBe(false)
})

test('prepared session commits require both workspace snapshots and destination revision', async () => {
  const { ctx } = setup()
  const input = args({ kind: 'move-session', sessionId: 's', folderId: 'b' })
  const prepared = await begin(ctx, input)
  const value = commitArgs(input, prepared)
  expect(validate(folderCommitArgs, value)).toBe(true)
  const { targetRevision: _targetRevision, ...withoutRevision } =
    value.plan as Extract<typeof value.plan, { kind: 'move-session' }>
  expect(validate(folderCommitArgs, { ...value, plan: withoutRevision })).toBe(
    false,
  )
})

test('cancellation is repeatable and never clears a replaced or foreign lock', async () => {
  const { ctx, row } = setup()
  const input = args({ kind: 'move-session', sessionId: 's', folderId: 'b' })
  await begin(ctx, input)
  row('s').contextLock = 'replacement'
  await cancel(ctx, cancelArgs(input))
  expect(row('s').contextLock).toBe('replacement')
  row('s').contextLock = input.token
  await cancel(ctx, { ...cancelArgs(input), subject: 'member' })
  expect(row('s').contextLock).toBe(input.token)
  await cancel(ctx, cancelArgs(input))
  await cancel(ctx, cancelArgs(input))
  expect(row('s').contextLock).toBeUndefined()
})

test('source changes after preparation reject a session commit', async () => {
  const { ctx, row } = setup()
  const input = args({ kind: 'move-session', sessionId: 's', folderId: 'b' })
  const prepared = await begin(ctx, input)
  row('a').revision = Number(row('a').revision) + 1
  await expect(commit(ctx, commitArgs(input, prepared))).rejects.toThrow(
    'Folder sources changed',
  )
  expect(row('s').folderId).toBe('a')
})

test.each(['lock', 'commit', 'cancel'])(
  'cleanup still unlocks after %s failure and preserves the original error',
  async (failure) => {
    const { ctx } = setup()
    const input = args({ kind: 'move-session', sessionId: 's', folderId: 'b' })
    const prepared = await begin(ctx, input)
    if (prepared.kind !== 'prepared') throw new Error('Expected preparation')
    const calls: string[] = []
    const original = new Error(
      failure === 'lock' ? 'lock failed' : 'commit failed',
    )
    const actionCtx = {
      runMutation: async (reference: Parameters<typeof getFunctionName>[0]) => {
        const name = getFunctionName(reference)
        calls.push(name)
        if (name.endsWith(':_commit')) throw original
        if (failure === 'cancel') throw new Error('cancel failed')
      },
    }
    const post = async (path: string) => {
      calls.push(path)
      if (failure === 'lock' && path.endsWith('/lock')) throw original
    }
    const errors = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        commitPrepared(actionCtx as never, input, prepared, post as never),
      ).rejects.toBe(original)
      expect(calls.at(-1)).toBe('/workspace/unlock')
      expect(calls).toContain('sessionFolders:_cancel')
      if (failure === 'cancel') expect(errors).toHaveBeenCalledTimes(1)
    } finally {
      errors.mockRestore()
    }
  },
)

test('a committed revision remains successful when sidecar unlock fails', async () => {
  const { ctx } = setup()
  const input = args({ kind: 'move-session', sessionId: 's', folderId: 'b' })
  const prepared = await begin(ctx, input)
  if (prepared.kind !== 'prepared') throw new Error('Expected preparation')
  const actionCtx = { runMutation: async () => 7 }
  const post = async (path: string) => {
    if (path.endsWith('/unlock')) throw new Error('unlock failed')
  }
  const errors = spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(
      await commitPrepared(actionCtx as never, input, prepared, post as never),
    ).toBe(7)
    expect(errors).toHaveBeenCalledTimes(1)
  } finally {
    errors.mockRestore()
  }
})

test('editing empty sources preserves caches when workspace authority is unchanged', async () => {
  const { ctx, row } = setup()
  row('a').sources = []
  const prepared = await begin(
    ctx,
    args({ kind: 'update-sources', folderId: 'a', sources: [] }),
  )
  expect(prepared.kind).toBe('completed')
  expect(row('cache')).toBeDefined()
  expect(row('a').revision).toBe(2)
})
