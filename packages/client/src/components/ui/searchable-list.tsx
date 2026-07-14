import { useDebouncedCallback } from '@/hooks'
import { cn } from '@/lib/utils'
import { useState } from 'react'

import { FilterableList, type FilterableListProps } from './filterable-list'
import { Input } from './input'

export type SearchableListProps<T> = Omit<FilterableListProps<T>, 'filter'> & {
  /** Show the search field only once the item count exceeds this. */
  searchThreshold?: number
  searchPlaceholder?: string
  /**
   * Server-backed search. When provided, the query is reported here (debounced)
   * instead of filtering client-side, and the search field is always shown.
   */
  onSearchChange?: (query: string) => void
  searchDebounce?: number
  /** Rendered next to the search field (e.g. an "Add" button). */
  actions?: React.ReactNode
  containerClassName?: string
  headerClassName?: string
  searchClassName?: string
}

/** A list on top of {@link FilterableList} that enables server-side search. */
export function SearchableList<T>({
  items,
  searchThreshold = 3,
  searchPlaceholder = 'Search...',
  onSearchChange,
  searchDebounce = 250,
  actions,
  containerClassName,
  headerClassName,
  searchClassName,
  hasMore,
  ...listProps
}: SearchableListProps<T>) {
  const [query, setQuery] = useState('')
  const commitSearch = useDebouncedCallback(
    (value: string) => onSearchChange?.(value),
    searchDebounce,
  )

  const server = !!onSearchChange
  const showSearch = server
    ? (items?.length ?? 0) > searchThreshold || !!hasMore || query !== ''
    : (items?.length ?? 0) > searchThreshold

  function handleQueryChange(value: string) {
    setQuery(value)
    if (server) commitSearch.run(value)
  }

  return (
    <div className={cn('flex flex-col gap-2', containerClassName)}>
      {(showSearch || actions) && (
        <div className={cn('flex items-center gap-2', headerClassName)}>
          {showSearch && (
            <Input
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={handleQueryChange}
              className={cn('h-10 flex-1', searchClassName)}
            />
          )}
          {actions && (
            <div className={cn(!showSearch && 'ml-auto')}>{actions}</div>
          )}
        </div>
      )}
      <FilterableList
        items={items}
        filter={server ? undefined : query}
        hasMore={hasMore}
        {...listProps}
      />
    </div>
  )
}
