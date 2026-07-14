
import Fuse from 'fuse.js'
import { useEffect, useMemo } from 'react'

import { useDebouncedState } from '.'

export type FuseProps<T> = {
  items?: T[]
  fields?: (keyof T)[]
  filter?: string
  threshold?: number
}

export function useFuse<T>({ items, fields, filter, threshold }: FuseProps<T>) {
  const [debouncedFilter, setDebouncedFilter] = useDebouncedState(filter, 200)

  const fuse = useMemo(() => {
    if (!items || filter === undefined || threshold === 0) {
      return undefined
    }

    return new Fuse(items, {
      isCaseSensitive: false,
      minMatchCharLength: 1,
      shouldSort: false,
      threshold: threshold ?? 0.4,
      keys: (fields as string[]) ?? [],
    })
  }, [items, filter, fields, threshold])

  const filteredItems = useMemo(() => {
    if (!items || !debouncedFilter) return items

    // bypass fuse when threshold is 0
    if (fields && threshold === 0) {
      const filter = debouncedFilter.toLowerCase()

      return items.filter((item) =>
        fields.some((field) => {
          const value = item[field] as string | undefined
          return value ? value.toLowerCase().includes(filter) : false
        }),
      )
    }

    if (!fuse) return items
    return fuse.search(debouncedFilter).map((result) => result.item)
  }, [fuse, debouncedFilter, items, fields, threshold])

  useEffect(() => {
    setDebouncedFilter(filter?.trim())
  }, [setDebouncedFilter, filter])

  return filteredItems
}
