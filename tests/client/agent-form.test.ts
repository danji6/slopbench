/// <reference types="bun-types" />
import {
  EMPTY_AGENT_FORM,
  EMPTY_AGENT_PROMPT_SETS,
  agentToFormValues,
  formValuesToPatch,
} from '@/components/chat/entities/agent/agent-form'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import { describe, expect, test } from 'bun:test'
import { createFormControl } from 'react-hook-form'

const AGENT_ID = 'a1' as Id<'agents'>

/** An agent that overrides nothing: every optional field is absent. */
function bareAgent(overrides: Partial<Doc<'agents'>> = {}): Doc<'agents'> {
  return {
    _id: AGENT_ID,
    _creationTime: 0,
    userId: 'u1',
    name: 'Agent',
    ...overrides,
  } as Doc<'agents'>
}

/**
 * One form serves every agent, so a field that is `undefined` after a reset is
 * read from the default the mounted field captured — the agent edited before.
 * This pins the react-hook-form behaviour the mapping is written against.
 */
describe('react-hook-form undefined contract', () => {
  test('falls back to a captured default, but not past null', () => {
    const form = createFormControl<{ chatWidth?: number | null }>({
      defaultValues: { chatWidth: 800 },
    })
    // What a mounted Controller memoizes once and reuses for every later read
    const captured = form.getValues().chatWidth

    form.reset({ chatWidth: undefined })
    expect(form.watch('chatWidth', captured)).toBe(800)

    form.reset({ chatWidth: null })
    expect(form.watch('chatWidth', captured)).toBeNull()
  })
})

describe('agent form values', () => {
  test('maps every absent field to null, never undefined', () => {
    // The regression: `chatWidth` was mapped straight from the document, so an
    // agent without one showed — and kept editing — the previous agent's width.
    const values = agentToFormValues(bareAgent(), EMPTY_AGENT_PROMPT_SETS)

    const undefinedKeys = Object.entries(values)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key)
    expect(undefinedKeys).toEqual([])
    expect(values.chatWidth).toBeNull()
  })

  test('covers every field the form holds', () => {
    // A field missing here is a field that keeps the previous agent's value
    expect(
      Object.keys(
        agentToFormValues(bareAgent(), EMPTY_AGENT_PROMPT_SETS),
      ).sort(),
    ).toEqual(Object.keys(EMPTY_AGENT_FORM).sort())
  })

  test('the empty form holds no undefined either', () => {
    const undefinedKeys = Object.entries(EMPTY_AGENT_FORM)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key)
    expect(undefinedKeys).toEqual([])
  })

  test('reads the values an agent does carry', () => {
    const values = agentToFormValues(
      bareAgent({ chatWidth: 1200, temperature: 0.4, mathMode: 'double' }),
      EMPTY_AGENT_PROMPT_SETS,
    )

    expect(values.chatWidth).toBe(1200)
    expect(values.temperature).toBe(0.4)
    expect(values.mathMode).toBe('double')
  })
})

describe('agent update payload', () => {
  test('names every cleared field in unset', async () => {
    // Convex drops undefined from mutation args, so a field can only be removed
    // by name. Whatever the form cleared has to be in there.
    const patch = await formValuesToPatch(AGENT_ID, {
      ...EMPTY_AGENT_FORM,
      name: 'Agent',
    })

    expect(patch.unset).toContain('chatWidth')
    expect(patch.unset).toContain('temperature')
    expect(patch.unset).toContain('mathMode')
    expect(patch.unset).toContain('scrollMode')
    expect(patch.chatWidth).toBeUndefined()
    expect(patch.temperature).toBeUndefined()
  })

  test('sends the values that are set, and unsets nothing of theirs', async () => {
    const patch = await formValuesToPatch(AGENT_ID, {
      ...EMPTY_AGENT_FORM,
      name: 'Agent',
      chatWidth: 1200,
      temperature: 0.4,
      scrollMode: 'follow',
    })

    expect(patch.chatWidth).toBe(1200)
    expect(patch.temperature).toBe(0.4)
    expect(patch.scrollMode).toBe('follow')
    expect(patch.unset).not.toContain('chatWidth')
    expect(patch.unset).not.toContain('temperature')
    expect(patch.unset).not.toContain('scrollMode')
  })

  test('round-trips an agent without touching what it holds', async () => {
    const agent = bareAgent({ chatWidth: 1200, temperature: 0.4 })
    const patch = await formValuesToPatch(
      AGENT_ID,
      agentToFormValues(agent, EMPTY_AGENT_PROMPT_SETS),
    )

    expect(patch.chatWidth).toBe(agent.chatWidth)
    expect(patch.temperature).toBe(agent.temperature)
    expect(patch.unset).not.toContain('chatWidth')
  })
})
