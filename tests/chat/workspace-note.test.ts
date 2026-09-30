/// <reference types="bun-types" />
import {
  buildWorkspaceNoteContent,
  workspaceChanged,
} from '@sb/convex/model/chat/notes'
import { describe, expect, test } from 'bun:test'

const ws = (label: string) => ({
  workspaceId: `ws_${label}`,
  label,
  path: `/srv/${label}`,
})

describe('workspaceChanged', () => {
  test('changing sources within the same folder counts as a change', () => {
    const previous = { ...ws('old'), workspaceId: 'ws_shared' }
    const next = { ...ws('new'), workspaceId: 'ws_shared' }

    expect(workspaceChanged(previous, next)).toBe(true)
  })

  test('unchanged folder sources are not a change', () => {
    expect(workspaceChanged(ws('same'), ws('same'))).toBe(false)
  })

  test('binding and unbinding are changes', () => {
    expect(workspaceChanged(undefined, ws('new'))).toBe(true)
    expect(workspaceChanged(ws('old'), undefined)).toBe(true)
    expect(workspaceChanged(undefined, undefined)).toBe(false)
  })
})

describe('workspace note', () => {
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
      'Relative file paths and the shell working directory',
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
    expect(content).toContain('File and shell tools are unavailable')
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
  expect(
    workspaceChanged(context, {
      ...context,
      sources: [...context.sources].reverse(),
    }),
  ).toBe(true)
})
