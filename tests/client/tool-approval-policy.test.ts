import {
  alwaysLabel,
  approvalHold,
  buildApprovalActions,
} from '@/lib/chat/tool-approval-policy'
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
