import {
  MAX_ASK_OPTIONS,
  MAX_ASK_OPTION_DESCRIPTION_CHARS,
  MAX_ASK_OPTION_LABEL_CHARS,
  MAX_ASK_QUESTIONS,
  MAX_ASK_QUESTION_CHARS,
  MAX_ASK_RESPONSE_CHARS,
} from '@sb/core/limits'
import { TOOL_DESCRIPTIONS } from '@sb/core/types'

/** Builds the client-executed tool that pauses a turn for human input. */
export async function createAskTool() {
  const [{ tool }, { z }] = await Promise.all([import('ai'), import('zod')])

  const option = z.object({
    label: z.string().trim().min(1).max(MAX_ASK_OPTION_LABEL_CHARS),
    description: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ASK_OPTION_DESCRIPTION_CHARS)
      .optional(),
    recommended: z.boolean().optional(),
  })

  const question = z
    .object({
      question: z.string().trim().min(1).max(MAX_ASK_QUESTION_CHARS),
      options: z.array(option).min(2).max(MAX_ASK_OPTIONS),
      multiple: z.boolean().optional(),
    })
    .superRefine(({ options }, ctx) => {
      const labels = new Set(options.map(({ label }) => label.toLowerCase()))
      if (labels.size !== options.length) {
        ctx.addIssue({
          code: 'custom',
          message: 'Option labels must be unique within a question.',
          path: ['options'],
        })
      }
      if (options.filter(({ recommended }) => recommended).length > 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'At most one option may be recommended.',
          path: ['options'],
        })
      }
    })

  return tool({
    description: TOOL_DESCRIPTIONS.ask,
    inputSchema: z.object({
      questions: z.array(question).min(1).max(MAX_ASK_QUESTIONS),
    }),
    outputSchema: z.union([
      z.object({
        aborted: z.literal(true),
        reason: z.string(),
      }),
      z.object({
        answeredBy: z.string(),
        answers: z.array(
          z.union([
            z.object({
              questionIndex: z.number().int().nonnegative(),
              question: z.string(),
              skipped: z.literal(true),
            }),
            z.object({
              questionIndex: z.number().int().nonnegative(),
              question: z.string(),
              answer: z.string().max(MAX_ASK_RESPONSE_CHARS),
              selectedOptionIndices: z
                .array(z.number().int().nonnegative())
                .min(1)
                .max(MAX_ASK_OPTIONS)
                .optional(),
              note: z.string().max(MAX_ASK_RESPONSE_CHARS).optional(),
              skipped: z.literal(false).optional(),
            }),
          ]),
        ),
        aborted: z.literal(false).optional(),
      }),
    ]),
  })
}
