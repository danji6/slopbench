import { RippleButton } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { Doc, Id } from '@sb/convex/_generated/dataModel'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Virtualizer } from 'virtua'

export type SkillListItem = Pick<
  Doc<'skills'>,
  '_id' | 'name' | 'description' | 'status'
> & {
  assignmentId: Id<'agentSkills'> | null
}

type SkillListProps = {
  items: SkillListItem[]
  actionLabel: string
  busy: boolean
  onAction: (item: SkillListItem) => void
  onRemove?: (item: SkillListItem) => void
  className?: string
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted'
  loadMore: (count: number) => void
}

export function SkillList({
  items,
  actionLabel,
  busy,
  onAction,
  onRemove,
  className,
  status,
  loadMore,
}: SkillListProps) {
  const scroll = useRef<HTMLDivElement>(null)
  return (
    <div
      ref={scroll}
      role="list"
      className={cn('max-h-96 overflow-x-hidden overflow-y-auto', className)}
      aria-label={onRemove ? 'Agent skills' : `${actionLabel} skills`}
    >
      <Virtualizer scrollRef={scroll}>
        {items.map((item) => (
          <SkillRow
            key={item._id}
            item={item}
            actionLabel={actionLabel}
            busy={busy}
            onAction={onAction}
            onRemove={onRemove}
          />
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

type SkillRowProps = Pick<
  SkillListProps,
  'actionLabel' | 'busy' | 'onAction' | 'onRemove'
> & { item: SkillListItem }

function SkillRow({
  item,
  actionLabel,
  busy,
  onAction,
  onRemove,
}: SkillRowProps) {
  const added = !!onRemove && item.assignmentId !== null
  const unavailable = !!onRemove && item.status !== 'ready'
  return (
    <div
      role="listitem"
      className="border-border flex flex-wrap items-start gap-3 border-b py-3"
    >
      <div className="min-w-0 flex-1 basis-40">
        <p className="font-medium wrap-break-word">
          <span>{item.name || 'Installing skill…'}</span>
          {added && (
            <span className="text-primary ml-2 text-sm font-bold">
              (Added)
            </span>
          )}
        </p>
        <SkillDescription description={item.description} />
      </div>
      <div className="flex shrink-0 gap-2">
        <RippleButton
          size="sm"
          variant="input"
          disabled={busy || added || unavailable}
          onClick={() => onAction(item)}
        >
          {actionLabel}
        </RippleButton>
        {added && (
          <RippleButton
            size="sm"
            variant="input"
            disabled={busy}
            onClick={() => onRemove?.(item)}
          >
            Remove
          </RippleButton>
        )}
      </div>
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
