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
  // The sidecar reuses one workspaceId per session across re-binds, so an
  // id comparison would never see a change.
  test('a re-bind under a reused workspaceId counts as a change', () => {
    const previous = { ...ws('old'), workspaceId: 'ws_shared' }
    const next = { ...ws('new'), workspaceId: 'ws_shared' }

    expect(workspaceChanged(previous, next)).toBe(true)
  })

  test('re-binding the same root is not a change', () => {
    expect(workspaceChanged(ws('same'), ws('same'))).toBe(false)
  })

  test('binding and unbinding are changes', () => {
    expect(workspaceChanged(undefined, ws('new'))).toBe(true)
    expect(workspaceChanged(ws('old'), undefined)).toBe(true)
    expect(workspaceChanged(undefined, undefined)).toBe(false)
  })
})

describe('workspace note', () => {
  test('a re-bind names both workspaces', () => {
    const content = buildWorkspaceNoteContent(ws('old'), ws('new'))

    expect(content).toStartWith('<system-reminder>')
    expect(content).toEndWith('</system-reminder>')
    expect(content).toContain('is now "new" (/srv/new)')
    expect(content).toContain('previously "old" (/srv/old)')
  })

  test('a first bind has no previous workspace to mention', () => {
    const content = buildWorkspaceNoteContent(undefined, ws('new'))

    expect(content).toContain('is now "new" (/srv/new)')
    expect(content).not.toContain('previously')
  })

  test('unbinding names the workspace that went away', () => {
    const content = buildWorkspaceNoteContent(ws('old'), undefined)

    expect(content).toContain('"old" (/srv/old) was unbound')
    expect(content).toContain('nothing to operate on')
  })
})
