import type { Id } from '@sb/convex/_generated/dataModel'
import { assignName, findName } from '@sb/convex/model/mcpBrokerNames'
import { expect, test } from 'bun:test'

import { skillsDatabase } from '../helpers/skills-db'

const session = 'chat' as Id<'sessions'>

test('duplicate native names receive stable suffixes without stealing literal suffixed names', async () => {
  const { ctx, rows } = skillsDatabase()
  expect(
    await assignName(ctx, session, 'tool', 'native-suffix', 'analyze_1'),
  ).toBe('analyze_1')
  expect(await assignName(ctx, session, 'tool', 'one', 'analyze')).toBe(
    'analyze',
  )
  expect(await assignName(ctx, session, 'tool', 'two', 'analyze')).toBe(
    'analyze_2',
  )
  expect(await assignName(ctx, session, 'tool', 'three', 'analyze')).toBe(
    'analyze_3',
  )
  expect(await assignName(ctx, session, 'tool', 'two', 'renamed')).toBe(
    'analyze_2',
  )
  expect(rows('mcpBrokerNames')).toHaveLength(4)
  expect((await findName(ctx, session, 'tool', 'analyze_2'))?.target).toBe(
    'two',
  )
})

test('replaced targets reserve new names; sessions and name kinds are independent', async () => {
  const { ctx } = skillsDatabase()
  expect(await assignName(ctx, session, 'tool', 'old-catalog', 'inspect')).toBe(
    'inspect',
  )
  expect(await assignName(ctx, session, 'tool', 'new-catalog', 'inspect')).toBe(
    'inspect_1',
  )
  expect((await findName(ctx, session, 'tool', 'inspect'))?.target).toBe(
    'old-catalog',
  )
  expect(await assignName(ctx, session, 'server', 'server', 'inspect')).toBe(
    'inspect',
  )
  expect(
    await assignName(
      ctx,
      'child' as Id<'sessions'>,
      'tool',
      'other',
      'inspect',
    ),
  ).toBe('inspect')
  expect(
    await findName(ctx, 'child' as Id<'sessions'>, 'tool', 'inspect_1'),
  ).toBeNull()
})
