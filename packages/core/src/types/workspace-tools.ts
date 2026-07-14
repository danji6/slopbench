import { z } from 'zod'

export const readFileFields = {
  path: z.string().describe('Workspace-relative path to read'),
  offset: z.number().optional().describe('1-indexed line offset'),
  limit: z.number().optional().describe('Maximum lines to read'),
} as const

export const writeFileFields = {
  path: z
    .string({ error: 'path is required: a workspace-relative file path.' })
    .describe('Workspace-relative path to write'),
  content: z
    .string({
      error:
        'content is required: pass the complete file text as a plain string.',
    })
    .describe('Complete file content'),
} as const

export const editFileFields = {
  path: z
    .string({ error: 'path is required: a workspace-relative file path.' })
    .describe('Workspace-relative path to edit'),
  edits: z
    .array(
      z.object(
        {
          oldText: z
            .string({
              error:
                'oldText is required inside each edits[] entry, not as a top-level field.',
            })
            .describe('Exact text to replace. Must be unique in the original file and must not overlap any other edit.'),
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
