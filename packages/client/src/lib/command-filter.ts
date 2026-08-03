import { defaultFilter } from 'cmdk'

/** Scores a command item against the search query. */
export function commandFilter(
  value: string,
  search: string,
  keywords?: string[],
): number {
  return defaultFilter(keywords?.length ? keywords.join(' ') : value, search)
}
