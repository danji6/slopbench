import { useEffect, useState } from 'react'

export type KeyboardViewport = {
  bottomInset: number
  height?: number
}

/** Converts visual viewport geometry into dock positioning constraints. */
export function keyboardViewport(
  layoutHeight: number,
  viewport?: Pick<VisualViewport, 'height' | 'offsetTop'>,
): KeyboardViewport {
  if (!viewport) return { bottomInset: 0 }
  return {
    bottomInset: Math.max(
      0,
      layoutHeight - viewport.height - viewport.offsetTop,
    ),
    height: viewport.height,
  }
}

/** Tracks the visible height and layout bottom obscured by a virtual keyboard. */
export function useKeyboardViewport() {
  const [metrics, setMetrics] = useState<KeyboardViewport>({ bottomInset: 0 })

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setMetrics(keyboardViewport(window.innerHeight, vv))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return metrics
}

/** Height of the layout viewport hidden behind the virtual keyboard. */
export function useKeyboardInset() {
  return useKeyboardViewport().bottomInset
}
