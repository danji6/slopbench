import { truncate } from '@sb/core/utils/strings'

export const APPROVAL_LABEL_MAX_LENGTH = 64

/** Builds a bounded single line label to prevent exposing long command payloads. */
export function formatAlwaysAllowLabel(patterns: string[]): string {
  const list = patterns.map((pattern) => `\`${pattern}\``).join(', ')
  const label = `Allow for this session: ${list}`
  return truncate(label.replace(/\s+/g, ' ').trim(), APPROVAL_LABEL_MAX_LENGTH)
}
