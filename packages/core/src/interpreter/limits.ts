export const EVAL_LIMITS = {
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  executionMs: 1000,
  deadlineMs: 5000,
  concurrency: 2,
  queueLength: 32,
} as const
