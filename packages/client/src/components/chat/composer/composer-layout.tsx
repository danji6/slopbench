import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

/** Width at which the composer switches to its compact text layout. */
export const COMPOSER_COMPACT_WIDTH = 480

type ComposerLayout = {
  compact: boolean
}

const ComposerLayoutContext = createContext<ComposerLayout>({ compact: false })

export const ComposerLayoutProvider = ComposerLayoutContext.Provider

export const useComposerLayout = () => useContext(ComposerLayoutContext)

/** Measures the composer toolbar and returns its responsive layout state. */
export function useMeasuredComposerLayout() {
  const toolbarRef = useRef<HTMLFieldSetElement>(null)
  const [compact, setCompact] = useState(false)

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return

    const update = () =>
      setCompact(toolbar.clientWidth < COMPOSER_COMPACT_WIDTH)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => ({ compact }), [compact])

  return { compact, layout, toolbarRef }
}
