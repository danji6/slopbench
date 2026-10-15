import { APP_ID } from '@sb/core/const'

import { createLocalStorageStore } from '../local-storage-store'

const MAX_RECENT_DIRECTORIES = 10
const EMPTY_DIRECTORIES: string[] = []

type RecentDirectories = { paths?: string[] }

const store = createLocalStorageStore<RecentDirectories>(
  `${APP_ID}-recent-directories`,
)

export const subscribeRecentDirectories = store.subscribe

export function getRecentDirectories(): string[] {
  return store.get().paths ?? EMPTY_DIRECTORIES
}

/** Remembers a confirmed directory, placing it before earlier selections. */
export function rememberDirectory(path: string): void {
  store.set({
    paths: [
      path,
      ...getRecentDirectories().filter((item) => item !== path),
    ].slice(0, MAX_RECENT_DIRECTORIES),
  })
}
