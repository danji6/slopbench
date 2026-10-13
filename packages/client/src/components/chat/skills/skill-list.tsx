import { RippleButton } from '@/components/ui'
import type { Doc } from '@sb/convex/_generated/dataModel'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Virtualizer } from 'virtua'

export type SkillListItem =
  | Pick<Doc<'skills'>, '_id' | 'name' | 'description'>
  | Pick<Doc<'agentSkills'>, '_id' | 'name' | 'description'>

type SkillListProps = {
  items: SkillListItem[]
  actionLabel: string
  busy: boolean
  onAction: (item: SkillListItem) => void
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'
  loadMore: (count: number) => void
}

export function SkillList({
  items,
  actionLabel,
  busy,
  onAction,
  status,
  loadMore,
}: SkillListProps) {
  const scroll = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={scroll}
      className="max-h-96 overflow-y-auto"
      aria-label={`${actionLabel} skills`}
    >
      <Virtualizer scrollRef={scroll}>
        {items.map((item) => (
          <div
            key={item._id}
            className="border-border flex items-start gap-3 border-b py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium wrap-break-word">
                {item.name || 'Installing skill…'}
              </p>
              <SkillDescription description={item.description} />
            </div>
            <RippleButton
              size="sm"
              variant="input"
              disabled={busy}
              onClick={() => onAction(item)}
            >
              {actionLabel}
            </RippleButton>
          </div>
        ))}
        <SkillLoadMore
          key="load-more"
          status={status}
          loadMore={loadMore}
          empty={!items.length}
          root={scroll}
        />
      </Virtualizer>
    </div>
  )
}

function SkillDescription({ description }: { description: string }) {
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
        className={`text-muted-foreground text-sm wrap-break-word ${expanded ? '' : 'line-clamp-2'}`}
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

type LoadMoreProps = Pick<SkillListProps, 'status' | 'loadMore'> & {
  empty: boolean
  root: React.RefObject<HTMLDivElement | null>
}

function SkillLoadMore({ status, loadMore, empty, root }: LoadMoreProps) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element || status !== 'CanLoadMore') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore(20)
      },
      { root: root.current, rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [status, loadMore, root])
  return (
    <div
      ref={sentinel}
      className="text-muted-foreground min-h-8 py-2 text-sm"
      role="status"
    >
      {status === 'LoadingFirstPage' || status === 'LoadingMore'
        ? 'Loading skills…'
        : empty && status === 'Exhausted'
          ? 'No skills found.'
          : null}
    </div>
  )
}
