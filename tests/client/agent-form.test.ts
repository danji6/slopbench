/// <reference types="bun-types" />
import {
  EMPTY_AGENT_FORM,
  EMPTY_AGENT_PROMPT_SETS,
  agentToFormValues,
  formValuesToCreate,
  formValuesToPatch,
  newAgentFormValues,
  splitAgentForm,
} from '@/components/chat/entities/agent/agent-form'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import { DEFAULT_SYSTEM_PROMPT } from '@sb/convex/model/defaults'
import { agentMutableFieldsValidator } from '@sb/convex/validators/args'
import type { Prompt } from '@sb/core/types'
import { describe, expect, test } from 'bun:test'
import { createFormControl } from 'react-hook-form'

const AGENT_ID = 'a1' as Id<'agents'>

const PROMPT: Prompt = {
  id: 'p1',
  name: 'System',
  role: 'system',
  content: 'be helpful',
  enabled: true,
  visible: false,
  starter: false,
}

describe('new agent form', () => {
  test('includes the normal creation defaults without needing an agent ID', () => {
    const values = newAgentFormValues()
    expect(values.name).toBe('New agent')
    expect(values.prompts).toContainEqual(
      expect.objectContaining({ content: DEFAULT_SYSTEM_PROMPT }),
    )
    expect(values.prompts).toContainEqual({ type: 'system-boundary' })
    expect(values.prompts).toContainEqual({ type: 'message-history' })
    expect(newAgentFormValues().prompts[0]).not.toEqual(values.prompts[0])
  })

  test('creates every edited scope and omits update-only and cleared fields', async () => {
    const args = await formValuesToCreate({
      ...newAgentFormValues(),
      name: 'Writer',
      compactionPrompts: [PROMPT],
      impersonationPrompts: [PROMPT],
      reminderPrompts: [
        {
          id: 'r1',
          name: 'Reminder',
          role: 'system',
          content: 'Check',
          interval: 2,
          enabled: true,
        },
      ],
      autoApprovePaths: ['/project'],
    })
    expect(args.name).toBe('Writer')
    expect(args.compactionPrompts).toEqual([PROMPT])
    expect(args.impersonationPrompts).toEqual([PROMPT])
    expect(args.reminderPrompts?.[0].interval).toBe(2)
    expect(args.autoApprove?.paths).toEqual(['/project'])
    expect(args).not.toHaveProperty('agentId')
    expect(args).not.toHaveProperty('unset')
    expect(args.chatWidth).toBeUndefined()
    expect(args.theme).toBeUndefined()
  })
})

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
      bareAgent({ chatWidth: 1200, mathMode: 'double' }),
      EMPTY_AGENT_PROMPT_SETS,
    )

    expect(values.chatWidth).toBe(1200)
    expect(values.mathMode).toBe('double')
  })
})

describe('the two halves of the form', () => {
  test('prompt sets go to their rows, never into the agent patch', async () => {
    // The regression: the whole form was patched onto the agent, and the
    // mutation rejected `prompts` as a field it no longer has.
    const { doc, sets } = splitAgentForm({
      ...EMPTY_AGENT_FORM,
      prompts: [PROMPT],
      compactionPrompts: [PROMPT],
    })

    expect(sets.prompts).toEqual([PROMPT])
    expect(sets.compactionPrompts).toEqual([PROMPT])
    expect(Object.keys(doc)).not.toContain('prompts')

    const patch = await formValuesToPatch(AGENT_ID, doc)
    expect(Object.keys(patch)).not.toContain('prompts')
  })

  test('sends only fields the mutation accepts', async () => {
    // Pinned to the validator itself, so the form can't drift from it again
    const fields = new Set(Object.keys(agentMutableFieldsValidator))
    const { doc } = splitAgentForm(EMPTY_AGENT_FORM)
    const patch = await formValuesToPatch(AGENT_ID, doc)

    const { agentId: _id, name: _name, unset, ...rest } = patch
    expect(Object.keys(rest).filter((key) => !fields.has(key))).toEqual([])
    expect((unset ?? []).filter((key) => !fields.has(key))).toEqual([])
  })
})

describe('agent update payload', () => {
  test('preserves disabled code preferences and clears them back to inheritance', async () => {
    const values = agentToFormValues(
      bareAgent({ codeBlockHighlighting: false, codeBlockLineNumbers: false }),
      EMPTY_AGENT_PROMPT_SETS,
    )
    const patch = await formValuesToPatch(AGENT_ID, values)
    const created = await formValuesToCreate(values)
    for (const name of [
      'codeBlockHighlighting',
      'codeBlockLineNumbers',
    ] as const) {
      expect(values[name]).toBe(false)
      expect(patch[name]).toBe(false)
      expect(created[name]).toBe(false)
      expect(patch.unset).not.toContain(name)
    }
    const cleared = await formValuesToPatch(AGENT_ID, EMPTY_AGENT_FORM)
    expect(cleared.unset).toContain('codeBlockHighlighting')
    expect(cleared.unset).toContain('codeBlockLineNumbers')
    const inherited = await formValuesToCreate(newAgentFormValues())
    expect(inherited.codeBlockHighlighting).toBeUndefined()
    expect(inherited.codeBlockLineNumbers).toBeUndefined()
  })

  test('names every cleared field in unset', async () => {
    // Convex drops undefined from mutation args, so a field can only be removed
    // by name. Whatever the form cleared has to be in there.
    const patch = await formValuesToPatch(AGENT_ID, {
      ...EMPTY_AGENT_FORM,
      name: 'Agent',
    })

    expect(patch.unset).toContain('chatWidth')
    expect(patch.unset).toContain('mathMode')
    expect(patch.unset).toContain('scrollMode')
    expect(patch.chatWidth).toBeUndefined()
  })

  test('sends the values that are set, and unsets nothing of theirs', async () => {
    const patch = await formValuesToPatch(AGENT_ID, {
      ...EMPTY_AGENT_FORM,
      name: 'Agent',
      chatWidth: 1200,
      scrollMode: 'follow',
    })

    expect(patch.chatWidth).toBe(1200)
    expect(patch.scrollMode).toBe('follow')
    expect(patch.unset).not.toContain('chatWidth')
    expect(patch.unset).not.toContain('scrollMode')
  })

  test('round-trips an agent without touching what it holds', async () => {
    const agent = bareAgent({ chatWidth: 1200 })
    const patch = await formValuesToPatch(
      AGENT_ID,
      agentToFormValues(agent, EMPTY_AGENT_PROMPT_SETS),
    )

    expect(patch.chatWidth).toBe(agent.chatWidth)
    expect(patch.unset).not.toContain('chatWidth')
  })
})

describe('agent path grants', () => {
  test('round-trips a paths-only agent and clears its last grant', async () => {
    const values = agentToFormValues(
      bareAgent({ autoApprove: { paths: ['src', '/tmp/shared'] } }),
      EMPTY_AGENT_PROMPT_SETS,
    )
    expect((await formValuesToPatch(AGENT_ID, values)).autoApprove).toEqual({
      paths: ['src', '/tmp/shared'],
    })
    const cleared = await formValuesToPatch(AGENT_ID, {
      ...values,
      autoApprovePaths: [],
    })
    expect(cleared.unset).toContain('autoApprove')
    expect(cleared.autoApprove).toBeUndefined()
    expect(
      agentToFormValues(bareAgent(), EMPTY_AGENT_PROMPT_SETS).autoApprovePaths,
    ).toEqual([])
  })
})

describe('subagent model form settings', () => {
  const override = {
    agentId: 'child' as Id<'agents'>,
    modelId: 'fast',
    reasoningEffort: 'low' as const,
  }

  test('round-trips independent overrides even with an empty whitelist', async () => {
    const values = agentToFormValues(
      bareAgent({
        subAgents: { mode: 'allow', agentIds: [], overrides: [override] },
      }),
      EMPTY_AGENT_PROMPT_SETS,
    )
    expect(values.subAgentOverrides).toEqual([override])
    const patch = await formValuesToPatch(AGENT_ID, values)
    expect(patch.subAgents).toEqual({
      mode: 'allow',
      agentIds: [],
      overrides: [override],
    })
    expect(patch.unset).not.toContain('subAgents')
    expect(
      agentToFormValues(bareAgent(), EMPTY_AGENT_PROMPT_SETS).subAgentOverrides,
    ).toEqual([])
  })

  test('clears empty overrides and retains reasoning-only overrides', async () => {
    const patch = await formValuesToPatch(AGENT_ID, {
      ...EMPTY_AGENT_FORM,
      subAgentOverrides: [{ agentId: override.agentId, modelId: '  ' }],
    })
    expect(patch.unset).toContain('subAgents')
    const reasoningOnly = {
      agentId: override.agentId,
      reasoningEffort: 'auto' as const,
    }
    const next = await formValuesToPatch(AGENT_ID, {
      ...EMPTY_AGENT_FORM,
      subAgentOverrides: [reasoningOnly],
    })
    expect(next.subAgents?.overrides).toEqual([reasoningOnly])
  })

  test('preserves overrides through selection and list-mode changes', async () => {
    for (const mode of ['allow', 'deny'] as const) {
      for (const agentIds of [[], [override.agentId]]) {
        const patch = await formValuesToPatch(AGENT_ID, {
          ...EMPTY_AGENT_FORM,
          subAgentsMode: mode,
          subAgentIds: agentIds,
          subAgentOverrides: [override],
        })
        expect(patch.subAgents?.overrides).toEqual([override])
      }
    }
  })
})
