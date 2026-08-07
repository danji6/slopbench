import { createLocalStorageStore } from '../local-storage-store'

const STORAGE_KEY = 'update-check'

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdateCheck = {
  checkedAt?: number
  current?: string
  latest?: string
  notes?: string
  publishedAt?: string
  url?: string
  available?: boolean
}

const store = createLocalStorageStore<UpdateCheck>(STORAGE_KEY)

export function getUpdateCheck(): UpdateCheck {
  return store.get()
}

export function setUpdateCheck(check: Omit<UpdateCheck, 'checkedAt'>) {
  store.set({ ...check, checkedAt: Date.now() })
}

export function subscribeToUpdateCheck(listener: () => void) {
  return store.subscribe(listener)
}

export function isUpdateCheckStale(
  check: UpdateCheck,
  now = Date.now(),
): boolean {
  return !check.checkedAt || now - check.checkedAt >= UPDATE_CHECK_INTERVAL_MS
}
