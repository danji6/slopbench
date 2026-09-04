/// <reference types="bun-types" />
import {
  isShellCommandAutoApproved,
  isToolAutoApproved,
  isUnrestrictedAccess,
  mergeToolApprovals,
} from '@sb/convex/lib/tool/approval'
import { describe, expect, test } from 'bun:test'

describe('mergeToolApprovals', () => {
  test('returns the session approvals when the agent has none', () => {
    const session = { tools: ['write_file'], paths: ['/tmp'] }
    expect(mergeToolApprovals(session, undefined)).toBe(session)
    expect(mergeToolApprovals(session, {})).toBe(session)
    expect(mergeToolApprovals(session, { tools: [], shell: [] })).toBe(session)
  })

  test('unions tools and shell, deduplicated', () => {
    const merged = mergeToolApprovals(
      { tools: ['write_file'], shell: ['git checkout'] },
      { tools: ['write_file', 'edit_file'], shell: ['find'] },
    )
    expect(merged?.tools).toEqual(['write_file', 'edit_file'])
    expect(merged?.shell).toEqual(['git checkout', 'find'])
  })

  test('keeps paths session-only', () => {
    const merged = mergeToolApprovals(
      { paths: ['/workspace/dist'] },
      { tools: ['edit_file'] },
    )
    expect(merged?.paths).toEqual(['/workspace/dist'])
    expect(merged?.tools).toEqual(['edit_file'])
  })

  test('keeps the session approval mode', () => {
    const merged = mergeToolApprovals(
      { mode: 'unrestricted' },
      { tools: ['edit_file'] },
    )
    expect(merged?.mode).toBe('unrestricted')
    expect(isUnrestrictedAccess(merged)).toBe(true)
  })

  test('works without any session approvals', () => {
    const merged = mergeToolApprovals(undefined, {
      tools: ['write_file'],
      shell: ['cargo build'],
    })
    expect(merged?.tools).toEqual(['write_file'])
    expect(merged?.shell).toEqual(['cargo build'])
    expect(merged?.paths).toBeUndefined()
  })
})

describe('merged approvals through the approval checks', () => {
  test('unrestricted access approves every tool and command pattern', () => {
    const approvals = { mode: 'unrestricted' as const }
    expect(isToolAutoApproved('edit_file', undefined, approvals)).toBe(true)
    expect(
      isToolAutoApproved('shell', { command: 'rm -rf .git' }, approvals),
    ).toBe(true)
  })

  test('agent-approved tools skip the approval prompt', () => {
    const merged = mergeToolApprovals(undefined, { tools: ['write_file'] })
    expect(isToolAutoApproved('write_file', undefined, merged)).toBe(true)
    expect(isToolAutoApproved('read_file', undefined, merged)).toBe(false)
  })

  test('write_file and edit_file share one approval', () => {
    const merged = mergeToolApprovals(undefined, { tools: ['write_file'] })
    expect(isToolAutoApproved('edit_file', undefined, merged)).toBe(true)
    expect(isToolAutoApproved('write_file', undefined, merged)).toBe(true)
  })

  test('agent shell patterns extend the session allowlist', () => {
    const merged = mergeToolApprovals(
      { shell: ['git push'] },
      { shell: ['cargo build'] },
    )
    expect(isShellCommandAutoApproved('cargo build', merged?.shell ?? [])).toBe(
      true,
    )
    expect(isShellCommandAutoApproved('git push', merged?.shell ?? [])).toBe(
      true,
    )
    expect(
      isShellCommandAutoApproved('cargo publish', merged?.shell ?? []),
    ).toBe(false)
  })
})
