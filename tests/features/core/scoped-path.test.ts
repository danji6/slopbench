import {
  isRelativeFilePath,
  selectFileWorkspace,
  withAgentHome,
} from '@sb/core/workspace/personal'
import {
  parseScopedPath,
  scopedDisplayPath,
} from '@sb/core/workspace/scoped-path'
import { expect, test } from 'bun:test'

test('filesystem prefixes preserve literal filenames and root references', () => {
  expect(parseScopedPath('agent://')).toEqual({
    scope: 'agent',
    path: '.',
    explicit: true,
  })
  expect(parseScopedPath('workspace://src/../note%20?#.txt')).toEqual({
    scope: 'workspace',
    path: 'src/../note%20?#.txt',
    explicit: true,
  })
  expect(scopedDisplayPath('agent://file', '.')).toBe('agent://')
  expect(scopedDisplayPath('workspace://old', 'new')).toBe('workspace://new')
  expect(scopedDisplayPath('old', 'new')).toBe('new')
})

test.each([
  'note.txt',
  '/tmp/note',
  'C:\\project\\note',
  'D:/project/note',
  './agent:note',
])('native path remains unchanged: %s', (value) => {
  expect(parseScopedPath(value)).toEqual({
    scope: 'workspace',
    path: value,
    explicit: false,
  })
})

test.each([
  'agent:/file',
  'agent:\\file',
  'workspace:file',
  'AGENT://file',
  'http://file',
  'file://file',
  'agent:///tmp/file',
  'agent://C:/file',
  'agent://../file',
  'workspace://a/../../file',
  'agent://a\\..\\..\\file',
  'agent://a\0b',
])('rejects invalid or escaping scoped paths: %s', (value) => {
  expect(() => parseScopedPath(value)).toThrow()
})

test('relative classification recognizes virtual and Windows paths', () => {
  for (const value of ['agent://file', 'workspace://', 'C:\\file', '/file'])
    expect(isRelativeFilePath(value)).toBe(false)
  expect(isRelativeFilePath('file')).toBe(true)
})

test('agent prefix always uses the active agent and fails without its folder', () => {
  const project = { workspaceId: 'p', path: '/project', label: 'Project' }
  for (const agentId of ['parent', 'child']) {
    const home = {
      agentId,
      ownerId: 'owner',
      path: `/homes/${agentId}`,
      revision: 0,
    }
    expect(
      selectFileWorkspace(
        withAgentHome(project, home),
        'agent://skills/review/SKILL.md',
      ).path,
    ).toBe(home.path)
  }
  expect(() => selectFileWorkspace(project, 'agent://file')).toThrow(
    'not available',
  )
})
