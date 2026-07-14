import { type FuseProps, useFuse } from '@/hooks'
import { cn } from '@/lib/utils'
import { mergeProps } from '@base-ui/react'
import { AnimatePresence, type HTMLMotionProps, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Empty, LoadingIndicator } from '.'

export type FilterableListProps<T> = HTMLMotionProps<'ul'> &
  FuseProps<T> & {
    items?: T[]
    keys: (item: T) => string | number
    render: (item: T, index: number) => React.ReactNode
    placeholder?: [number, () => React.ReactNode] | null
    empty?: () => React.ReactNode
    className?: string
    itemProps?: HTMLMotionProps<'li'>
    pageSize?: number
    scrollRef?: React.RefObject<HTMLElement | null>
    /** When undefined, client pagination is performed instead. */
    onLoadMore?: () => void
    hasMore?: boolean
  }

export type FilterableListItemsProps<T> = {
  items: T[]
  keys: (item: T) => string | number
  render: (item: T, index: number) => React.ReactNode
} & HTMLMotionProps<'li'>

export function FilterableList<T>({
  items,
  keys,
  render,
  filter,
  fields,
  threshold,
  placeholder = [1, () => <LoadingIndicator />],
  empty = () => <Empty />,
  pageSize,
  scrollRef,
  onLoadMore,
  hasMore: externalHasMore,
  className,
  itemProps,
  ...props
}: FilterableListProps<T>) {
  const filteredItems = useFuse({ items, filter, fields, threshold })
  const { visible, hasMore, sentinelRef } = usePagedItems(
    filteredItems,
    pageSize,
    scrollRef,
    onLoadMore ? { onLoadMore, hasMore: externalHasMore } : undefined,
  )

  return (
    <motion.ul
      className={cn('relative', className)}
      data-slot="filterable-list"
      {...props}
    >
      {visible ? (
        visible.length > 0 ? (
          <>
            <Items items={visible} keys={keys} render={render} {...itemProps} />
            {hasMore && (
              <li
                ref={sentinelRef}
                aria-hidden
                className="pointer-events-none h-1"
              />
            )}
          </>
        ) : (
          empty()
        )
      ) : placeholder ? (
        <Placeholders count={placeholder[0]} render={placeholder[1]} />
      ) : null}
    </motion.ul>
  )
}

function usePagedItems<T>(
  items: T[] | undefined,
  pageSize: number | undefined,
  scrollRef: React.RefObject<HTMLElement | null> | undefined,
  external?: { onLoadMore: () => void; hasMore?: boolean },
) {
  const [page, setPage] = useState(1)
  const [prevItems, setPrevItems] = useState(items)
  const sentinelRef = useRef<HTMLLIElement>(null)
  const loadMore = useCallback(() => setPage((p) => p + 1), [])

  if (pageSize && items !== prevItems) {
    setPrevItems(items)
    setPage(1)
  }

  const visible = external
    ? items
    : pageSize && items
      ? items.slice(0, page * pageSize)
      : items
  const hasMore = external
    ? !!external.hasMore
    : !!(pageSize && items && items.length > page * pageSize)
  const triggerLoadMore = external ? external.onLoadMore : loadMore

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) triggerLoadMore()
      },
      { root: scrollRef?.current ?? null, rootMargin: '100px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, triggerLoadMore, scrollRef])

  return { visible, hasMore, sentinelRef }
}

function Items<T>({
  items,
  keys,
  render,
  className,
  ...props
}: FilterableListItemsProps<T>) {
  return (
    <AnimatePresence mode="popLayout">
      {items.map((item, index) => (
        <motion.li
          key={keys(item)}
          data-slot="filterable-list-item"
          layout
          className={cn('m-0 w-fit max-w-full shrink-0', className)}
          {...mergeProps(
            {
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              exit: { opacity: 0 },
              transition: { duration: 0.15 },
            },
            props,
          )}
        >
          {render(item, index)}
        </motion.li>
      ))}
    </AnimatePresence>
  )
}

function Placeholders({
  count,
  render,
}: {
  count: number
  render: () => React.ReactNode
}) {
  if (count <= 1) {
    return (
      <div className="flex size-full items-center justify-center">
        {render()}
      </div>
    )
  }

  return Array.from({ length: count }).map((_, index) => (
    <motion.li
      // biome-ignore lint/suspicious/noArrayIndexKey: placeholder
      key={index}
      data-slot="list-item"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {render()}
    </motion.li>
  ))
}
