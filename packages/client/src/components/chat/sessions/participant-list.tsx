import { Input } from '@/components/ui'
import { Fragment, type ReactNode, useState } from 'react'

const SEARCH_THRESHOLD = 3

interface ParticipantListProps<T> {
  items: T[]
  getKey: (item: T) => string
  getSearchText: (item: T) => string
  renderItem: (item: T) => ReactNode
  emptyLabel: string
  footer?: ReactNode
  searchPlaceholder?: string
}

export function ParticipantList<T>({
  items,
  getKey,
  getSearchText,
  renderItem,
  emptyLabel,
  footer,
  searchPlaceholder = 'Search...',
}: ParticipantListProps<T>) {
  const [query, setQuery] = useState('')

  const normalized = query.trim().toLowerCase()
  const filtered = normalized
    ? items.filter((item) =>
        getSearchText(item).toLowerCase().includes(normalized),
      )
    : items

  const showSearch = items.length > SEARCH_THRESHOLD || query !== ''

  return (
    <div className="flex flex-col gap-2">
      <header className="flex flex-col gap-2 px-3">
        {showSearch && (
          <Input
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            className="border-input/50 h-10"
          />
        )}
      </header>

      <div className="flex flex-col gap-1 px-2">
        {filtered.length === 0 ? (
          <div className="text-muted-foreground p-2 text-center text-xs">
            {items.length === 0 ? emptyLabel : 'No matches.'}
          </div>
        ) : (
          filtered.map((item) => (
            <Fragment key={getKey(item)}>{renderItem(item)}</Fragment>
          ))
        )}
        {footer}
      </div>
    </div>
  )
}
