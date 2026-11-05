import { buildApprovalActions } from '@/lib/chat/tool-approval-policy'
import { alwaysLabel, approvalHold } from '@sb/convex/lib/tool/approvalPolicy'
import { describe, expect, test } from 'bun:test'

describe('approval choices', () => {
  test.each(['plan', 'analysis', 'forbidden'] as const)(
    'does not offer an ineffective session grant for a %s hold',
    (hold) => {
      const actions = buildApprovalActions(
        true,
        'Allow for this session: `tool`',
        hold,
      )
      expect(actions.map((action) => action.id)).toEqual([
        'approve',
        'deny',
        'abort',
      ])
    },
  )

  test('keeps session grants when they can remove the hold', () => {
    expect(
      buildApprovalActions(true, 'Allow for this session: `tool`', null).map(
        (action) => action.id,
      ),
    ).toContain('remember-patterns')
    expect(
      buildApprovalActions(true, null, 'paths').map((action) => action.id),
    ).toContain('remember-paths')
  })

  test('remembered mutations retain the plan hold without another session grant', () => {
    const input = { command: 'git branch new' }
    expect(alwaysLabel('shell', input, { shell: ['git branch'] })).toBeNull()
    expect(approvalHold('shell', input, 'plan')).toBe('plan')
  })

  test('runner prefix grants suppress redundant session approval choices', () => {
    const input = { command: 'bun run tests toolkits' }
    expect(alwaysLabel('shell', input, { shell: ['bun run'] })).toBeNull()
    expect(approvalHold('shell', input, 'plan')).toBe('plan')
  })

  test('file session choices preserve ordinary edits and require resolved paths', () => {
    for (const toolName of ['read_file', 'write_file', 'edit_file']) {
      const input = { path: 'src/file.ts' }
      const label = alwaysLabel(toolName, input, {})
      const ordinary = approvalHold(toolName, input, undefined, null)
      expect(
        buildApprovalActions(true, label, ordinary).map((action) => action.id),
      ).toContain('remember-patterns')

      const unresolved = approvalHold(toolName, input, undefined, 'analysis')
      expect(
        buildApprovalActions(true, label, unresolved).some(
          (action) => action.remember,
        ),
      ).toBe(false)
    }
  })

  test.each([
    'nl -ba src/file.ts',
    'git branch -a && git tag --sort=-creatordate | head -20',
  ])(
    'does not put supported read-only commands on a plan hold: %s',
    (command) => {
      expect(approvalHold('shell', { command }, 'plan')).toBeNull()
      expect(approvalHold('shell', { command }, 'plan', 'paths')).toBe('paths')
      expect(approvalHold('shell', { command }, 'plan', 'forbidden')).toBe(
        'forbidden',
      )
    },
  )
})
