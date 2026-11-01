export const CHATGPT_ROUTING_HEADERS = {
  token: 'x-codex-turn-state',
  revision: 'x-slopbench-auth-revision',
  sent: 'x-slopbench-continuity-sent',
  reset: 'x-slopbench-continuity-reset',
  invalid: 'x-slopbench-continuity-invalid',
  upstreamStatus: 'x-slopbench-upstream-status',
} as const
