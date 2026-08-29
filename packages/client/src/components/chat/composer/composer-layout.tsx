import { createContext, useContext } from 'react'

/** Width at which the composer switches to its compact text layout. */
export const COMPOSER_COMPACT_WIDTH = 480

type ComposerLayout = {
  compact: boolean
}

const ComposerLayoutContext = createContext<ComposerLayout>({ compact: false })

export const ComposerLayoutProvider = ComposerLayoutContext.Provider

export const useComposerLayout = () => useContext(ComposerLayoutContext)
