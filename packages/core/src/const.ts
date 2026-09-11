/** Internal app identifier, never shown to users. */
export const APP_ID = 'slopbench'
/** App name shown to the users. */
export const APP_NAME = 'Slopbench'

export const FALLBACK_DISPLAY_NAME = 'Anonymous'

// Byte budgets for message pagination and streaming splits. Sizes are
// serialized UTF-16 code units (see `serializedSize`), not true bytes.
/** Content budget for a single message window fetch. */
export const MESSAGE_PAGE_BUDGET_BYTES = 128 * 1024
/** Content budget for the full retained message window. */
export const MESSAGE_WINDOW_BUDGET_BYTES = 512 * 1024
/** A streaming agent message splits once its parts exceed this. */
export const MESSAGE_SPLIT_BUDGET_BYTES = 64 * 1024
/** Row count safety cap for a single message window fetch. */
export const MESSAGE_PAGE_MAX_ROWS = 40
/** Row count safety cap for the full retained message window. */
export const MESSAGE_WINDOW_MAX_ROWS = 160

/** Steps without a todo write/edit before unresolved todos trigger a nudge. */
export const TODO_NUDGE_INTERVAL_STEPS = 10

/** Single agent settings toggle covering both todo tools. */
export const TODO_TOOL_TOGGLE = 'todo'

/** Single agent settings toggle covering every plan tool. */
export const PLAN_TOOL_TOGGLE = 'plan'

/** Built-in client-executed tool used to pause for human decisions. */
export const ASK_TOOL_NAME = 'ask'

/** Built-in tool for reading attachments. */
export const READ_ATTACHMENT_TOOL_NAME = 'read_attachment'

/** Large plain text pastes become attachments at this UTF-8 byte size. */
export const LARGE_PASTE_BYTES = 16 * 1024

/** Default and maximum byte windows returned by read_attachment. */
export const ATTACHMENT_READ_MAX_BYTES = 64 * 1024
export const ATTACHMENT_READ_DEFAULT_BYTES = ATTACHMENT_READ_MAX_BYTES

/** Compact edit_todo statuses mapped to their stored counterparts. */
export const TODO_EDIT_STATUSES = {
  todo: 'pending',
  doing: 'in_progress',
  done: 'completed',
} as const

export type TodoEditStatus = keyof typeof TODO_EDIT_STATUSES
