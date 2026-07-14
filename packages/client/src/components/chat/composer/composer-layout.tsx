import { createContext, useContext } from 'react'

/**
 * Width at which secondary controls (e.g. agent picker) collapse into
 * the quick-settings popover.
 */
export const COMPOSER_COMPACT_WIDTH = 480

type ComposerLayout = {
  compact: boolean
}

const ComposerLayoutContext = createContext<ComposerLayout>({ compact: false })

export const ComposerLayoutProvider = ComposerLayoutContext.Provider

export const useComposerLayout = () => useContext(ComposerLayoutContext)
