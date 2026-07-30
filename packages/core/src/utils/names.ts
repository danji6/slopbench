import { FALLBACK_DISPLAY_NAME } from '../const'

/** Ensures the display name is never shown empty. */
export function toDisplayName(
  name: string | null | undefined,
  fallback: string = FALLBACK_DISPLAY_NAME,
): string {
  return name?.trim() || fallback
}

export function toOptionalName(
  name: string | null | undefined,
): string | undefined {
  return name?.trim() || undefined
}
