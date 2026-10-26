import { useLayoutEffect, useRef, useState } from 'react'

/** Shows a two-line description with an explicit control for the full text. */
export function ExpandableDescription({
  description,
}: {
  description: string
}) {
  const text = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const element = text.current
    if (!element) return
    const measure = () => {
      if (!expanded)
        setOverflow(element.scrollHeight > element.clientHeight + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [description, expanded])
  return (
    <>
      <p
        ref={text}
        className={`text-muted-foreground text-sm wrap-anywhere ${expanded ? '' : 'line-clamp-2'}`}
      >
        {description}
      </p>
      {(overflow || expanded) && (
        <button
          type="button"
          className="text-muted-foreground text-xs underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}
