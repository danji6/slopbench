import {
  checkInstalledSkills,
  removeConfirmedSkills,
} from '@sb/client/lib/chat/skill-verification'
import type { Id } from '@sb/convex/_generated/dataModel'
import { expect, test } from 'bun:test'

const ids = Array.from({ length: 47 }, (_, i) => `skill-${i}` as Id<'skills'>)

test('library checking traverses every page and retains all missing candidates', async () => {
  const cursors: (string | null)[] = []
  const progress: number[] = []
  const result = await checkInstalledSkills(
    async ({ paginationOpts }) => {
      cursors.push(paginationOpts.cursor)
      const offset = Number(paginationOpts.cursor ?? 0)
      const page = ids.slice(offset, offset + paginationOpts.numItems)
      return {
        checked: page.length,
        skipped: 0,
        missing: page.map((skillId) => ({ skillId, name: skillId })),
        isDone: offset + page.length >= ids.length,
        continueCursor: String(offset + page.length),
      }
    },
    (count) => progress.push(count),
  )
  expect(cursors).toEqual([null, '20', '40'])
  expect(progress).toEqual([20, 40, 47])
  expect(result.checked).toBe(47)
  expect(result.missing.map((s) => s.skillId)).toEqual(ids)
})

test('a later failed page rejects the scan instead of returning partial cleanup candidates', async () => {
  await expect(
    checkInstalledSkills(
      async ({ paginationOpts }) => {
        if (paginationOpts.cursor) throw new Error('Connection lost')
        return {
          checked: 20,
          skipped: 0,
          missing: [{ skillId: ids[0]!, name: 'first' }],
          isDone: false,
          continueCursor: '20',
        }
      },
      () => {},
    ),
  ).rejects.toThrow('Connection lost')
})

test('cleanup sends only confirmed IDs in bounded batches and counts recheck results', async () => {
  const batches: Id<'skills'>[][] = []
  const removed = await removeConfirmedSkills(async ({ skillIds }) => {
    batches.push(skillIds)
    return { removed: skillIds.length - 1 }
  }, ids)
  expect(batches.map((page) => page.length)).toEqual([20, 20, 7])
  expect(batches.flat()).toEqual(ids)
  expect(removed).toBe(44)
})

test('cleanup stops submitting batches after a failure', async () => {
  let calls = 0
  await expect(
    removeConfirmedSkills(async () => {
      calls++
      throw new Error('Busy home')
    }, ids),
  ).rejects.toThrow('Busy home')
  expect(calls).toBe(1)
})
