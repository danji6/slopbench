/// <reference types="bun-types" />
import {
  buildModeNoteContent,
  decideModeNote,
} from '@sb/convex/model/chat/notes'
import { describe, expect, test } from 'bun:test'

const withTools = { planTools: true, subagent: false }

describe('mode note', () => {
  test('plan mode states the restriction and the planning loop', () => {
    const content = buildModeNoteContent('plan', withTools)

    expect(content).toStartWith('<system-reminder>')
    expect(content).toEndWith('</system-reminder>')
    expect(content).toContain('CANNOT make any changes')
    expect(content).toContain('write_plan')
    expect(content).toContain('exit_plan_mode')
  })

  test('without the planning tools it never names them', () => {
    const content = buildModeNoteContent('plan', {
      planTools: false,
      subagent: false,
    })

    expect(content).toContain('CANNOT make any changes')
    expect(content).not.toContain('write_plan')
    expect(content).not.toContain('exit_plan_mode')
  })

  test('a sub-agent reports back instead of exiting plan mode', () => {
    const content = buildModeNoteContent('plan', {
      planTools: true,
      subagent: true,
    })

    expect(content).toContain('delegating agent')
    expect(content).toContain('write_plan')
    expect(content).not.toContain('exit_plan_mode')
  })

  test('normal mode lifts the restriction', () => {
    const content = buildModeNoteContent('normal', withTools)

    expect(content).toContain('Plan mode is no longer active')
    expect(content).not.toContain('CANNOT')
  })
})

describe('decideModeNote', () => {
  test('announces a change nothing has stated yet', () => {
    expect(decideModeNote({ next: 'plan', announced: 'normal' })).toEqual({
      remove: false,
      insert: { from: 'normal', to: 'plan' },
    })
  })

  test('stays silent when the transcript already states the mode', () => {
    expect(decideModeNote({ next: 'plan', announced: 'plan' })).toEqual({
      remove: false,
      insert: null,
    })
  })

  // A trailing chip means no turn consumed it, so it is rewritten in place
  test('a round trip back to the starting mode leaves no chip', () => {
    // normal -> plan -> normal, with nothing in between
    expect(
      decideModeNote({
        next: 'normal',
        announced: 'plan',
        trailing: { from: 'normal', to: 'plan' },
      }),
    ).toEqual({ remove: true, insert: null })
  })

  test('a trailing chip that already states the mode is left alone', () => {
    expect(
      decideModeNote({
        next: 'plan',
        announced: 'plan',
        trailing: { from: 'normal', to: 'plan' },
      }),
    ).toEqual({ remove: false, insert: null })
  })
})
