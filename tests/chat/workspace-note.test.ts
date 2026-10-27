/// <reference types="bun-types" />
import { buildWorkspaceNoteContent } from '@sb/convex/model/chat/notes'
import { describe, expect, test } from 'bun:test'

const ws = (label: string) => ({
  workspaceId: `ws_${label}`,
  label,
  path: `/srv/${label}`,
})

describe('personal-folder guidance', () => {
  test('personal-folder guidance follows availability even when project sources stay unchanged', () => {
    const project = ws('same')
    const home = {
      ownerId: 'owner',
      agentId: 'agent',
      path: '/home/agent',
      revision: 0,
    }
    const personal = { ...project, agentHome: home }
    expect(buildWorkspaceNoteContent(project, personal)).toContain('agent://')
    const detached = buildWorkspaceNoteContent(personal, project)
    expect(detached).toContain('personal folder is no longer available')
    expect(detached).not.toContain('agent://')
  })
})

describe('workspace note', () => {
  test('normal chats have no workspace reminder', () => {
    expect(buildWorkspaceNoteContent(undefined, undefined)).toBe('')
  })

  test('a source change explains the new base and re-reading requirement', () => {
    const content = buildWorkspaceNoteContent(ws('old'), ws('new'))

    expect(content).toStartWith('<system-reminder>')
    expect(content).toEndWith('</system-reminder>')
    expect(content).toContain('Primary source: /srv/new')
    expect(content).toContain('Re-read files')
  })

  test('a first bind reads as initial state, not a move', () => {
    const content = buildWorkspaceNoteContent(undefined, ws('new'))

    expect(content).toContain(
      'Relative file paths resolve from the primary source',
    )
    expect(content).toContain('/srv/new (Primary)')
    // Nothing was resolved earlier, so it must not read like a re-bind.
    expect(content).not.toContain('previously')
    expect(content).not.toContain('is now')
    expect(content).not.toContain('no longer apply')
    expect(content).not.toContain('Re-read')
  })

  test('removing sources clears earlier filesystem context', () => {
    const content = buildWorkspaceNoteContent(ws('old'), undefined)

    expect(content).toContain('no folder source directories')
    expect(content).toContain('Earlier filesystem context no longer applies')
  })
})

test('reminders enumerate all source roots and identify only the first as primary', () => {
  const context = {
    ...ws('project'),
    sources: [
      { id: '1', path: '/srv/project', label: 'project' },
      { id: '2', path: '/srv/library', label: 'library' },
    ],
  }
  const note = buildWorkspaceNoteContent(undefined, context)
  expect(note).toContain('- /srv/project (Primary)')
  expect(note).toContain('- /srv/library')
  expect(note).toContain('Use absolute paths for other source directories')
})
