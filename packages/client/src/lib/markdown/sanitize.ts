import { defaultSchema } from 'rehype-sanitize'

/** Sanitizer schema extended with the custom nodes our remark plugins emit. */
export const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'md-group',
    'md-meta',
    'md-quoted',
    'md-mention',
    'md-streaming-cursor',
  ],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    code: [
      [
        'className',
        /^language-./,
        // Prevent math classes from getting stripped
        'math-inline',
        'math-display',
      ],
      'data*',
    ],
    'md-group': ['type', 'items', 'direction'],
    'md-meta': ['content'],
    'md-mention': ['path'],
  },
}

/** Tags the sanitizer keeps; anything else renders as literal text. */
export const allowedTags = new Set(
  sanitizeSchema.tagNames.map((tag) => tag.toLowerCase()),
)
