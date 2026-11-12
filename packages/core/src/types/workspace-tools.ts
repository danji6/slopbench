import { z } from 'zod'

import { ATTACHMENT_READ_MAX_BYTES } from '../const'

export const readAttachmentFields = {
  reference: z
    .string()
    .optional()
    .describe('Attachment reference for a new read or search'),
  operationId: z
    .string()
    .length(12)
    .optional()
    .describe('Pass alone to continue an attachment operation'),
  pattern: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe(
      'Go regexp (RE2 syntax) to search line by line. Ignores case by default. Prefix with (?-i) to match case.',
    ),
  from: z
    .literal('end')
    .optional()
    .describe('Start at the end and page backward'),
  offset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Zero-based UTF-8 byte offset for a targeted plain read'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `UTF-8 text budget per page (defaults to and is capped at ${ATTACHMENT_READ_MAX_BYTES})`,
    ),
} as const

export type ReadAttachmentInput = z.infer<
  z.ZodObject<typeof readAttachmentFields>
>

export const readFileFields = {
  path: z.string().describe('Relative or absolute path to read'),
  byteOffset: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'UTF-8 byte offset; use nextByteOffset to continue a truncated read',
    ),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('1-indexed line offset'),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum lines to read'),
} as const

export const writeFileFields = {
  path: z
    .string({ error: 'path is required: a relative or absolute file path.' })
    .describe('Relative or absolute path to write'),
  content: z
    .string({
      error:
        'content is required: pass the complete file text as a plain string.',
    })
    .describe('Complete file content'),
} as const

export const editFileFields = {
  path: z
    .string({ error: 'path is required: a relative or absolute file path.' })
    .describe('Relative or absolute path to edit'),
  edits: z
    .array(
      z.object(
        {
          oldText: z
            .string({
              error:
                'oldText is required inside each edits[] entry, not as a top-level field.',
            })
            .describe(
              'Exact text to replace. Must be unique in the original file and must not overlap any other edit.',
            ),
          newText: z
            .string({
              error:
                'newText is required inside each edits[] entry, not as a top-level field.',
            })
            .describe('Replacement text.'),
        },
        {
          error:
            'each edits[] entry must be a single { oldText, newText } object, e.g. edits: [{ oldText: "...", newText: "..." }]. Do not wrap an entry in its own array.',
        },
      ),
      {
        error:
          'edits is required and must be an array of { oldText, newText } objects, e.g. edits: [{ oldText: "...", newText: "..." }]. Do not pass oldText/newText directly on the tool call.',
      },
    )
    .min(1, {
      error: 'edits must contain at least one { oldText, newText } object.',
    })
    .describe('Array of `{ oldText, newText }` replacements to apply.'),
} as const
