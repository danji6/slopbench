import { trackUntilSettled } from './scroll-settle'
import type { ScrollTarget } from './scroll-target'

type LayoutPositionOptions = {
  pending: () => boolean
  done: () => void
}

/** Retains the document offset while animated rows and virtual measurements settle. */
export function preserveLayoutPosition(
  target: ScrollTarget,
  { pending, done }: LayoutPositionOptions,
) {
  const top = target.getScrollTop()
  let height = target.getScrollHeight()

  const restore = () => {
    const bottom = Math.max(
      0,
      target.getScrollHeight() - target.getClientHeight(),
    )
    const position = Math.min(top, bottom)
    if (Math.abs(target.getScrollTop() - position) > 0.5) {
      target.setScrollTop(position)
    }
  }

  const cancel = trackUntilSettled(
    () => {
      restore()
      const next = target.getScrollHeight()
      const delta = next - height
      height = next
      return delta
    },
    { pending, onDone: done },
  )

  return { restore, cancel }
}
