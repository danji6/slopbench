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
