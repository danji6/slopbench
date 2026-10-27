import type { Id } from '@sb/convex/_generated/dataModel'
import { assignments } from '@sb/convex/model/skills/endpoints'
import { assigned, list } from '@sb/convex/model/skills/library'
import { setEnabled } from '@sb/convex/model/skills/preferences'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

const agentId = 'agent' as Id<'agents'>
const otherId = 'subagent' as Id<'agents'>
const assignmentId = 'assignment' as Id<'agentSkills'>
const skillId = 'skill' as Id<'skills'>
const paginationOpts = { cursor: null, numItems: 20 }

function setup() {
  const fixture = skillsDatabase()
  fixture
    .rows('agents')
    .push(
      { _id: agentId, ownerId: 'owner', homeId: 'home' },
      { _id: otherId, ownerId: 'owner', homeId: 'home' },
    )
  fixture.rows('skills').push({
    _id: skillId,
    ownerId: 'owner',
    name: 'review',
    description: 'Review changes',
    status: 'ready',
  })
  fixture.rows('agentSkills').push({
    _id: assignmentId,
    ownerId: 'owner',
    homeId: 'home',
    skillId,
    name: 'review',
    description: 'An edited assignment',
  })
  return fixture
}

test('assigned skills start enabled; toggles persist without changing files or assignments', async () => {
  const { ctx, db, rows, scheduled } = setup()
  const args = { agentId, paginationOpts }
  expect((await list(ctx, args)).page[0]!.enabled).toBe(true)
  const original = structuredClone(rows('agentSkills'))

  await setEnabled(ctx, { agentId, assignmentId, enabled: false })
  await setEnabled(ctx, { agentId, assignmentId, enabled: false })
  expect((await db.get(agentId))!.disabledSkillIds).toEqual([skillId])
  expect((await list(ctx, args)).page[0]!.enabled).toBe(false)
  expect(
    (await list(ctx, { ...args, assignment: 'added' })).page[0]!.enabled,
  ).toBe(false)
  expect((await assigned(ctx, args)).page).toHaveLength(1)
  expect(rows('agentSkills')).toEqual(original)
  expect(rows('agentFileOperations')).toHaveLength(0)
  expect(scheduled).toHaveLength(0)

  await setEnabled(ctx, { agentId, assignmentId, enabled: true })
  expect((await db.get(agentId))!.disabledSkillIds).toEqual([])
  expect((await list(ctx, args)).page[0]!.enabled).toBe(true)
})

test('agents and subagents sharing a folder have independent skill visibility', async () => {
  const { ctx } = setup()
  await setEnabled(ctx, { agentId, assignmentId, enabled: false })
  const args = { paginationOpts, enabledOnly: true }
  expect((await assignments(ctx, { ...args, agentId })).page).toHaveLength(0)
  expect(
    (await assignments(ctx, { ...args, agentId: otherId })).page,
  ).toHaveLength(1)
  expect(
    (await list(ctx, { agentId: otherId, paginationOpts })).page[0]!.enabled,
  ).toBe(true)
  // Filesystem copies and settings views still see disabled assignments.
  expect(
    (await assignments(ctx, { agentId, paginationOpts })).page,
  ).toHaveLength(1)
})

test('toggling one skill preserves other disabled choices and ownership checks', async () => {
  const { ctx, db, rows } = setup()
  const unrelated = 'another-skill' as Id<'skills'>
  await db.patch(agentId, { disabledSkillIds: [unrelated] })
  await setEnabled(ctx, { agentId, assignmentId, enabled: false })
  await setEnabled(ctx, { agentId, assignmentId, enabled: true })
  expect((await db.get(agentId))!.disabledSkillIds).toEqual([unrelated])

  const args = { agentId, assignmentId, enabled: false }
  await expect(setEnabled({ ...ctx, role: 'user' }, args)).rejects.toThrow(
    'Forbidden',
  )
  await expect(
    setEnabled({ ...ctx, userId: 'foreign' as Id<'users'> }, args),
  ).rejects.toThrow('Agent not found')
  await expect(
    setEnabled(ctx, { ...args, assignmentId: 'missing' as Id<'agentSkills'> }),
  ).rejects.toThrow('assignment not found')
  rows('agentSkills')[0]!.ownerId = 'foreign'
  await expect(setEnabled(ctx, args)).rejects.toThrow('assignment not found')
  rows('agentSkills')[0]!.ownerId = 'owner'
  rows('agentSkills')[0]!.homeId = 'another-home'
  await expect(setEnabled(ctx, args)).rejects.toThrow('not assigned')
  expect((await db.get(agentId))!.disabledSkillIds).toEqual([unrelated])
})

test('filtered catalogs keep database cursors across fully disabled pages and searches', async () => {
  const { ctx, db, rows } = setup()
  rows('agentSkills').length = 0
  const disabled: string[] = []
  for (let i = 0; i < 45; i++) {
    const name = `skill-${String(i).padStart(2, '0')}`
    rows('agentSkills').push({
      _id: `assignment-${i}`,
      ownerId: 'owner',
      homeId: 'home',
      skillId: name,
      name,
    })
    if (i < 25) disabled.push(name)
  }
  await db.patch(agentId, { disabledSkillIds: disabled })
  const args = { agentId, enabledOnly: true, paginationOpts }
  const first = await assignments(ctx, args)
  expect(first.page).toHaveLength(0)
  expect(first.isDone).toBe(false)
  const second = await assignments(ctx, {
    ...args,
    paginationOpts: { ...paginationOpts, cursor: first.continueCursor },
  })
  expect(second.page).toHaveLength(15)
  expect(second.page[0]!.name).toBe('skill-25')
  const third = await assignments(ctx, {
    ...args,
    paginationOpts: { ...paginationOpts, cursor: second.continueCursor },
  })
  expect(third.page).toHaveLength(5)
  expect(third.isDone).toBe(true)
  const search = await assignments(ctx, { ...args, search: 'SKILL-2' })
  expect(search.page.map((skill) => skill.name)).toEqual([
    'skill-25',
    'skill-26',
    'skill-27',
    'skill-28',
    'skill-29',
  ])
})
