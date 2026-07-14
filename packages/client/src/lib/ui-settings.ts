import { createLocalStorageStore } from './local-storage-store'

const STORAGE_KEY = 'ui-settings'

export type SidebarSide = 'left' | 'right'

export type SidebarState = {
  pinned?: boolean
  collapsed?: boolean
}

export type SidebarSettings = {
  left?: SidebarState
  right?: SidebarState
}

export type UiSettings = {
  sidebar?: SidebarSettings
}

const store = createLocalStorageStore<UiSettings>(STORAGE_KEY)

export function getSidebarState(side: SidebarSide): SidebarState {
  return store.get().sidebar?.[side] ?? {}
}

export function setSidebarState(side: SidebarSide, patch: SidebarState) {
  const sidebar = store.get().sidebar
  store.set({
    sidebar: { ...sidebar, [side]: { ...sidebar?.[side], ...patch } },
  })
}
