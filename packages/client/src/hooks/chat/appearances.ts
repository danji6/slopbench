import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ThemeSnapshot } from '@sb/convex/types'

import { createMediaUrlStore } from './media-urls'

export type Appearance = { css?: string; theme?: ThemeSnapshot }

const store = createMediaUrlStore(api.appearances.getMap)

/** Resolves every message look on screen in one query. */
export const AppearanceProvider = store.Provider

/** Eagerly adds looks to the shared subscription before they render. */
export const registerAppearanceIds = store.register

/** The theme and custom css a message was sent with. */
export function useAppearance(
  appearanceId?: Id<'appearances'>,
): Appearance | null {
  return store.useMediaUrl(appearanceId) ?? null
}
