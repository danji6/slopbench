import { type Options as SanitizeSchema, defaultSchema } from 'rehype-sanitize'

/** Sanitizer schema extended with the custom nodes our remark plugins emit. */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'label',
    'button',
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
    // Allow HTML with inline styling
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style', 'className'],
  },
}

/** Tags the sanitizer keeps; anything else renders as literal text. */
export const allowedTags = new Set(
  (sanitizeSchema.tagNames ?? []).map((tag) => tag.toLowerCase()),
)
