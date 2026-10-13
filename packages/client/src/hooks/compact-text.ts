import { type ReactNode, useLayoutEffect, useRef } from 'react'

/** Removes unused inline space after text wraps, including balanced text. */
function compactText(element: HTMLElement) {
  element.style.inlineSize = ''
  const range = document.createRange()
  range.selectNodeContents(element)
  const widths = Array.from(range.getClientRects(), (rect) => rect.width)
  const width = Math.max(0, ...widths)
  if (width > 0) element.style.inlineSize = `${Math.ceil(width)}px`
}

/** Fits text to its rendered lines when content, fonts, or available width change. */
export function useCompactText(content: ReactNode, styling?: string) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const element = ref.current
    const container = element?.parentElement?.parentElement
    if (!element || !container) return

    const update = () => compactText(element)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    document.fonts.addEventListener('loadingdone', update)

    return () => {
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', update)
    }
  }, [content, styling])

  return ref
}
