// Caps enforced on every field a user, model, or a third-party service can grow.
// Byte caps must stay under the 1MB document size limit.

export const MAX_SCOPE_PROMPTS = 100
export const MAX_PROMPT_CONTENT_CHARS = 200_000
export const MAX_PROMPT_NAME_CHARS = 100

export const MAX_MCP_SERVERS = 100
export const MAX_SERVER_MCP_TOOLS = 100
export const MAX_MCP_SCHEMA_CHARS = 20_000
export const MAX_MCP_DESCRIPTION_CHARS = 4_000

export const MAX_PROVIDERS = 100
export const MAX_PROVIDER_MODELS = 100

export const MAX_WEB_SEARCH_INSTANCES = 100

export const MAX_ENVIRONMENT_KEYS = 1000
export const MAX_ENVIRONMENT_BYTES = 256 * 1024

export const MAX_APPROVAL_PATTERNS = 500
export const MAX_APPROVAL_PATHS = 500

export const MAX_TODO_ITEMS = 100
export const MAX_TODO_CONTENT_CHARS = 5_000

export const MAX_PLAN_CONTENT_CHARS = 200_000

export const MAX_CUSTOM_CSS_CHARS = 5_000

export const MAX_SHELL_PATH_CHARS = 500

/**
 * A single `messageContents` row. Well under the 1MB limit to leave room for
 * metadata and search text.
 */
export const MAX_SEGMENT_BYTES = 768 * 1024

/** A single part. Parts are atomic, so oversized ones are simply rejected. */
export const MAX_MESSAGE_PART_BYTES = 512 * 1024
