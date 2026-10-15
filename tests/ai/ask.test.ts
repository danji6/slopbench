/// <reference types="bun-types" />
import { safeValidateTypes } from '@ai-sdk/provider-utils'
import { answerQuestions, buildAskToolOutput } from '@sb/convex/model/chat/ask'
import { createAskTool } from '@sb/convex/model/tool/ask'
import { resolveToolManifest } from '@sb/convex/model/tool/manifest'
import {
  MAX_ASK_OPTION_LABEL_CHARS,
  MAX_ASK_RESPONSE_CHARS,
} from '@sb/core/limits'
import { describe, expect, test } from 'bun:test'

const input = {
  questions: [
    {
      question: 'Which database?',
      options: [
        { label: 'PostgreSQL', recommended: true },
        { label: 'SQLite', description: 'Keep deployment local.' },
      ],
    },
    {
      question: 'Which color?',
      options: [{ label: 'Blue' }, { label: 'Green' }],
    },
  ],
}

describe('ask tool', () => {
  test('is a non-executable client tool with bounded input', async () => {
    const tool = await createAskTool()
    expect(tool.execute).toBeUndefined()
    expect(
      await safeValidateTypes({
        value: input,
        schema: tool.inputSchema as never,
      }),
    ).toMatchObject({ success: true })
    expect(
      await safeValidateTypes({
        value: {
          questions: [{ ...input.questions[0], multiple: true }],
        },
        schema: tool.inputSchema as never,
      }),
    ).toMatchObject({ success: true })
    expect(
      await safeValidateTypes({
        value: {
          aborted: true,
          reason: 'The user aborted this question request.',
        },
        schema: tool.outputSchema as never,
      }),
    ).toMatchObject({ success: true })
  })

  test('rejects duplicate labels and multiple recommendations', async () => {
    const tool = await createAskTool()
    const invalid = {
      questions: [
        {
          question: 'Pick one',
          options: [
            { label: 'Same', recommended: true },
            { label: 'same', recommended: true },
          ],
        },
      ],
    }
    expect(
      await safeValidateTypes({
        value: invalid,
        schema: tool.inputSchema as never,
      }),
    ).toMatchObject({ success: false })
  })

  test('rejects oversized tool fields', async () => {
    const tool = await createAskTool()
    const invalid = {
      questions: [
        {
          question: 'Pick one',
          options: [
            { label: 'x'.repeat(MAX_ASK_OPTION_LABEL_CHARS + 1) },
            { label: 'Valid' },
          ],
        },
      ],
    }
    expect(
      await safeValidateTypes({
        value: invalid,
        schema: tool.inputSchema as never,
      }),
    ).toMatchObject({ success: false })
  })

  test('is selectable for root sessions and absent from sub-agents', () => {
    const manifest = (parent: boolean, enabled: boolean) =>
      resolveToolManifest({
        agent: {
          tools: enabled ? ['ask'] : [],
        } as never,
        invoker: { role: 'user' } as never,
        session: {
          _id: 'session_1',
          ...(parent && { parent: { sessionId: 'parent' } }),
        } as never,
        resources: { settings: null, mcpServers: [] },
        spawnableAgents: [],
      })

    expect(manifest(false, true).names).toContain('ask')
    expect(manifest(false, false).names).not.toContain('ask')
    expect(manifest(true, true).names).not.toContain('ask')
  })
})

describe('ask tool output derivation', () => {
  test('derives selected labels, custom answers, notes, and respondent', () => {
    expect(
      buildAskToolOutput(
        input,
        [
          {
            questionIndex: 0,
            selectedOptionIndices: [0],
            note: 'Use Neon.',
          },
          { questionIndex: 1, customAnswer: 'Purple' },
        ],
        'Ada',
      ),
    ).toEqual({
      answeredBy: 'Ada',
      answers: [
        {
          questionIndex: 0,
          question: 'Which database?',
          answer: 'PostgreSQL',
          selectedOptionIndices: [0],
          note: 'Use Neon.',
        },
        {
          questionIndex: 1,
          question: 'Which color?',
          answer: 'Purple',
        },
      ],
    })
  })

  test('derives an explicit skipped result', () => {
    expect(
      buildAskToolOutput(
        { questions: [input.questions[0]!] },
        [{ questionIndex: 0, skipped: true }],
        'Ada',
      ),
    ).toEqual({
      answeredBy: 'Ada',
      answers: [
        {
          questionIndex: 0,
          question: 'Which database?',
          skipped: true,
        },
      ],
    })
  })

  test('rejects incomplete, duplicate, mixed, and oversized answers', () => {
    expect(() => buildAskToolOutput(input, [], 'Ada')).toThrow()
    expect(() =>
      buildAskToolOutput(
        input,
        [
          { questionIndex: 0, customAnswer: 'A' },
          { questionIndex: 0, customAnswer: 'B' },
        ],
        'Ada',
      ),
    ).toThrow()
    expect(() =>
      buildAskToolOutput(
        input,
        [
          {
            questionIndex: 0,
            selectedOptionIndices: [0],
            customAnswer: 'Both',
          },
          { questionIndex: 1, customAnswer: 'Purple' },
        ],
        'Ada',
      ),
    ).toThrow()
    expect(() =>
      buildAskToolOutput(
        input,
        [
          { questionIndex: 0, selectedOptionIndices: [99] },
          {
            questionIndex: 1,
            customAnswer: 'x'.repeat(MAX_ASK_RESPONSE_CHARS + 1),
          },
        ],
        'Ada',
      ),
    ).toThrow()
    expect(() =>
      buildAskToolOutput(
        input,
        [
          { questionIndex: 0, selectedOptionIndices: [0], skipped: true },
          { questionIndex: 1, customAnswer: 'Purple' },
        ],
        'Ada',
      ),
    ).toThrow()
  })

  test('derives several labels only for explicitly multi-choice questions', () => {
    const multi = {
      questions: [
        {
          question: ' Which features? ',
          options: [{ label: ' Search ' }, { label: 'Export' }],
          multiple: true,
        },
      ],
    }
    expect(
      buildAskToolOutput(
        multi,
        [
          {
            questionIndex: 0,
            selectedOptionIndices: [0, 1],
            note: ' Both matter. ',
          },
        ],
        'Ada',
      ),
    ).toEqual({
      answeredBy: 'Ada',
      answers: [
        {
          questionIndex: 0,
          question: 'Which features?',
          answer: 'Search, Export',
          selectedOptionIndices: [0, 1],
          note: 'Both matter.',
        },
      ],
    })

    expect(() =>
      buildAskToolOutput(
        { questions: [{ ...multi.questions[0]!, multiple: false }] },
        [{ questionIndex: 0, selectedOptionIndices: [0, 1] }],
        'Ada',
      ),
    ).toThrow()
    expect(() =>
      buildAskToolOutput(
        multi,
        [{ questionIndex: 0, selectedOptionIndices: [0, 0] }],
        'Ada',
      ),
    ).toThrow()
  })
})

describe('stored question validation', () => {
  test.each([
    { question: null, message: 'Each question must be an object' },
    {
      question: { question: ' ', options: [] },
      message: 'Question must be between',
    },
    {
      question: { question: 'Pick', options: [] },
      message: 'Each question must contain',
    },
    {
      question: { question: 'Pick', options: [null, {}] },
      message: 'Each option must be an object',
    },
    {
      question: {
        question: 'Pick',
        options: [{ label: ' A ' }, { label: 'a', description: '' }],
      },
      message: 'Option labels must be unique',
    },
    {
      question: {
        question: 'Pick',
        options: [
          { label: 'A', description: '', recommended: 'yes' },
          { label: 'B' },
        ],
      },
      message: 'Option description must be between',
    },
    {
      question: {
        question: 'Pick',
        options: [{ label: 'A', recommended: 'yes' }, { label: 'B' }],
        multiple: 'yes',
      },
      message: 'Recommended must be a boolean',
    },
    {
      question: {
        question: 'Pick',
        options: [
          { label: 'A', recommended: true },
          { label: 'B', recommended: true },
        ],
        multiple: 'yes',
      },
      message: 'At most one option may be recommended',
    },
    {
      question: {
        question: 'Pick',
        options: [{ label: 'A' }, { label: 'B' }],
        multiple: 'yes',
      },
      message: 'Multiple must be a boolean',
    },
  ])('preserves the first error: $message', ({ question, message }) => {
    expect(() =>
      buildAskToolOutput({ questions: [question] } as never, [], 'Ada'),
    ).toThrow(message)
  })

  test('accepts maximum-length option labels without changing whitespace derivation', () => {
    const label = 'x'.repeat(MAX_ASK_OPTION_LABEL_CHARS)
    const result = buildAskToolOutput(
      {
        questions: [
          { question: ' Pick ', options: [{ label }, { label: 'Other' }] },
        ],
      },
      [{ questionIndex: 0, selectedOptionIndices: [0] }],
      'Ada',
    )
    expect(result).toMatchObject({
      answers: [{ question: 'Pick', answer: label }],
    })
  })

  test.each([
    {
      draft: {
        customAnswer: 'x'.repeat(MAX_ASK_RESPONSE_CHARS + 1),
        note: 'x'.repeat(MAX_ASK_RESPONSE_CHARS + 1),
      },
      message: 'Custom answer is too long',
    },
    {
      draft: {
        customAnswer: 'A',
        skipped: 'yes',
        selectedOptionIndices: 'invalid',
      },
      message: 'Skipped must be a boolean',
    },
    {
      draft: { customAnswer: 'A', selectedOptionIndices: 'invalid' },
      message: 'Selected option indices must be an array',
    },
    {
      draft: { selectedOptionIndices: [0, 0] },
      message: 'This question only allows one selected option',
    },
  ])('preserves answer error precedence: $message', ({ draft, message }) => {
    expect(() =>
      buildAskToolOutput(
        { questions: [input.questions[0]!] },
        [{ questionIndex: 0, ...draft }] as never,
        'Ada',
      ),
    ).toThrow(message)
  })
})

describe('answerQuestions mutation', () => {
  test('allows a session member to answer once and resumes the stream', async () => {
    const session = { _id: 'session_1' }
    const stream = {
      _id: 'stream_1',
      sessionId: session._id,
      agentId: 'agent_1',
      leaseExpiresAt: Date.now() + 60_000,
      state: {
        phase: 'awaiting_input',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
      command: { kind: 'invoke' },
    }
    const message = { _id: 'message_1' }
    const content = {
      _id: 'content_1',
      messageId: message._id,
      sessionId: session._id,
      version: 1,
      segmentIndex: 0,
      parts: [
        {
          type: 'tool-ask',
          toolCallId: 'call_1',
          state: 'input-available',
          input: { questions: [input.questions[0]!] },
        },
      ],
    }
    const docs = new Map(
      [session, stream, message, content].map((doc) => [doc._id, doc]),
    )
    const scheduled: unknown[][] = []
    const ctx = {
      userId: 'user_2',
      db: {
        get: async (id: string) => docs.get(id) ?? null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          Object.assign(docs.get(id)!, patch)
        },
        query: (table: string) => {
          const chain = {
            withIndex: () => chain,
            first: async () => (table === 'streams' ? stream : null),
            unique: async () => {
              if (table === 'userSessions') {
                return { _id: 'membership_1', role: 'member' }
              }
              if (table === 'settings') {
                return { _id: 'settings_1', displayName: 'Ada' }
              }
              return null
            },
          }
          return chain
        },
      },
      scheduler: {
        runAfter: async (...args: unknown[]) => {
          scheduled.push(args)
          return 'job_1'
        },
      },
    } as never

    const args = {
      sessionId: session._id as never,
      toolCallId: 'call_1',
      answers: [{ questionIndex: 0, selectedOptionIndices: [0] }],
    }
    await answerQuestions(ctx, args)

    expect(content.parts[0]).toMatchObject({
      state: 'output-available',
      output: {
        answeredBy: 'Ada',
        answers: [expect.objectContaining({ answer: 'PostgreSQL' })],
      },
    })
    expect(stream).toMatchObject({
      state: { phase: 'pending', jobId: 'job_1' },
    })
    expect(scheduled).toHaveLength(1)

    await expect(answerQuestions(ctx, args)).rejects.toThrow()
  })
})
