import { buildWorkspaceNoteContent } from '@sb/convex/model/chat/notes'
import { catalogNote } from '@sb/convex/model/skills/runtime'
import { selectFileWorkspace, withAgentHome } from '@sb/core/workspace/personal'
import { parseSkillMetadata } from '@sb/sidecar/agent-files/metadata'
import { expect, test } from 'bun:test'

const home = {
  ownerId: 'owner',
  agentId: 'agent',
  path: '/homes/agent',
  revision: 0,
}
const project = {
  workspaceId: 'project',
  path: '/project',
  label: 'Project',
  sources: [{ id: 'source', path: '/project', label: 'Project' }],
}

test('personal scope keeps project grants anchored and leaves project sources unchanged', () => {
  const context = withAgentHome(project, home)
  const personal = selectFileWorkspace(context, 'agent')
  expect(context.path).toBe('/project')
  expect(context.sources).toEqual(project.sources)
  expect(personal.path).toBe(home.path)
  expect(personal.approvalRoot).toBe('/project')
  expect(personal.sources?.map((source) => source.path)).toEqual([
    home.path,
    '/project',
  ])
})

test('home-only sessions default to personal files and reject explicit project scope', () => {
  const context = withAgentHome(undefined, home)
  expect(context.path).toBe(home.path)
  expect(() => selectFileWorkspace(context, 'workspace')).toThrow('no project')
  const note = buildWorkspaceNoteContent(undefined, {
    ...context,
    folderId: undefined,
  })
  expect(note).toContain('scope: "agent"')
  expect(note).toContain('default to your personal folder')
})

test('catalog discovery exposes continuation and omits unavailable instructions', () => {
  const note = catalogNote({
    entries: [
      {
        name: 'review',
        description: 'Review code',
        path: '.agents/skills/review/SKILL.md',
      },
      { name: 'broken', description: '', path: '', error: 'Missing SKILL.md' },
    ],
    cursor: 'next-page',
    isDone: false,
  })
  expect(note).toContain('scope: agent')
  expect(note).toContain('list_skills')
  expect(note).toContain('next-page')
  expect(note).toContain('broken: unavailable')
})

test('metadata rejects missing fields, duplicate YAML keys and aliases', () => {
  expect(() => parseSkillMetadata('---\nname: review\n---')).toThrow(
    'description',
  )
  expect(() =>
    parseSkillMetadata(
      '---\nname: review\nname: other\ndescription: Test\n---',
    ),
  ).toThrow('YAML')
  expect(() =>
    parseSkillMetadata(
      '---\nname: review\ndescription: &a Test\nmetadata: { x: *a }\n---',
    ),
  ).toThrow()
})

test('metadata accepts unindented plain description continuations without changing the source', () => {
  const text =
    '---\nname: mod-any-game\ndescription: Mod a game.\nIt covers recon and a safe lab.\nUse whenever the user requests a mod.\nlicense: MIT\n---\nInstructions.'
  expect(parseSkillMetadata(text)).toEqual({
    name: 'mod-any-game',
    description:
      'Mod a game. It covers recon and a safe lab. Use whenever the user requests a mod.',
  })
  expect(text).toContain('\nIt covers')
})

test('description compatibility preserves standard YAML and rejects unrelated malformed fields', () => {
  for (const description of [
    'description: >-\n  Multiple lines.\n  Correctly folded.',
    'description: "Multiple lines. Correctly folded."',
  ]) {
    expect(
      parseSkillMetadata(`---\nname: review\n${description}\n---`).description,
    ).toBe('Multiple lines. Correctly folded.')
  }
  expect(() =>
    parseSkillMetadata(
      '---\nname: review\nnot a field\ndescription: Test\n---',
    ),
  ).toThrow('YAML')
  expect(() =>
    parseSkillMetadata(
      '---\nname: review\ndescription: Test\nContinuation.\nname: other\n---',
    ),
  ).toThrow('YAML')
  expect(() =>
    parseSkillMetadata(
      '---\nname: review\ndescription: "Test"\nContinuation.\n---',
    ),
  ).toThrow('YAML')
})
