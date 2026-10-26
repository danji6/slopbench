import { RippleButton, SelectionListItem, Switch } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { SkillListItem } from '@sb/convex/model/skills/skillListing'
import { useEffect, useRef } from 'react'
import { Virtualizer } from 'virtua'

export type { SkillListItem } from '@sb/convex/model/skills/skillListing'

type SkillListProps = {
  items: SkillListItem[]
  actionLabel: string
  busy: boolean
  onAction: (item: SkillListItem) => void
  onRemove?: (item: SkillListItem) => void
  onToggle?: (item: SkillListItem, enabled: boolean) => void
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
  onToggle,
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
            onToggle={onToggle}
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
  'actionLabel' | 'busy' | 'onAction' | 'onRemove' | 'onToggle'
> & { item: SkillListItem }

function SkillRow({
  item,
  actionLabel,
  busy,
  onAction,
  onRemove,
  onToggle,
}: SkillRowProps) {
  const added = !!onRemove && item.assignmentId !== null
  const unavailable = !!onRemove && item.status !== 'ready'
  return (
    <SelectionListItem
      label={item.name || 'Installing skill…'}
      added={added}
      description={item.description}
      actions={
        <>
          {added && onToggle && (
            <Switch
              size="sm"
              aria-label={`Enable ${item.name}`}
              checked={item.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => onToggle(item, enabled)}
            />
          )}
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
        </>
      }
    >
      {!item.libraryAvailable && added && (
        <p className="text-muted-foreground text-xs">Agent copy</p>
      )}
    </SelectionListItem>
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
