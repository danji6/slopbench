import { APP_ID } from '@sb/core/const'

import { createLocalStorageStore } from './local-storage-store'

const STORAGE_KEY = `${APP_ID}-ui-settings`

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
  sessionFolderByUser?: Record<string, string | null>
}

const store = createLocalStorageStore<UiSettings>(STORAGE_KEY)

export function getSelectedSessionFolder(userId: string): string | null {
  return store.get().sessionFolderByUser?.[userId] ?? null
}

export function setSelectedSessionFolder(
  userId: string,
  folderId: string | null,
) {
  if (getSelectedSessionFolder(userId) === folderId) return
  store.set({
    sessionFolderByUser: {
      ...store.get().sessionFolderByUser,
      [userId]: folderId,
    },
  })
}

export function getSidebarState(side: SidebarSide): SidebarState {
  return store.get().sidebar?.[side] ?? {}
}

export function setSidebarState(side: SidebarSide, patch: SidebarState) {
  const sidebar = store.get().sidebar
  store.set({
    sidebar: { ...sidebar, [side]: { ...sidebar?.[side], ...patch } },
  })
}
