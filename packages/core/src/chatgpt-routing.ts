import { APP_ID } from './const'

export const CHATGPT_ROUTING_HEADERS = {
  token: 'x-codex-turn-state',
  revision: `x-${APP_ID}-auth-revision`,
  sent: `x-${APP_ID}-continuity-sent`,
  reset: `x-${APP_ID}-continuity-reset`,
  invalid: `x-${APP_ID}-continuity-invalid`,
  upstreamStatus: `x-${APP_ID}-upstream-status`,
} as const
