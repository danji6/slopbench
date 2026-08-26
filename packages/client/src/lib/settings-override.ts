import type { ResolvedSettings } from '@sb/convex/model/defaults'
import { APP_ID } from '@sb/core/const'

import { createLocalStorageStore } from './local-storage-store'

const STORAGE_KEY = `${APP_ID}-settings-override`

export type SettingsOverride = Partial<ResolvedSettings>

const store = createLocalStorageStore<SettingsOverride>(STORAGE_KEY)

export function getSettingsOverride(): SettingsOverride {
  return store.get()
}

export function subscribeSettingsOverride(listener: () => void) {
  return store.subscribe(listener)
}

export function setSettingsOverride(patch: SettingsOverride) {
  store.set(patch)
}
