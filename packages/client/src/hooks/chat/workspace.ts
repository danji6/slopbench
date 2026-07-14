import { toast } from '@/lib/notifications'
import { useAction } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'

import { useSettings, useSettingsUpdate } from './settings'
import { useIsWorkspaceAdmin } from './tools'

const MAX_RECENT_WORKSPACES = 8
const FILE_INDEX_RESCAN_COOLDOWN_MS = 2_000

export function useRecentWorkspaces() {
  const settings = useSettings()
  const updateSettings = useSettingsUpdate()
  const recent = useMemo(
    () => settings?.recentWorkspaces ?? [],
    [settings?.recentWorkspaces],
  )

  const remember = useCallback(
    (root: string) => {
      const next = [root, ...recent.filter((item) => item !== root)].slice(
        0,
        MAX_RECENT_WORKSPACES,
      )
      void updateSettings({ patch: { recentWorkspaces: next } })
    },
    [recent, updateSettings],
  )

  const clear = useCallback(() => {
    void updateSettings({ patch: { recentWorkspaces: [] } })
  }, [updateSettings])

  return { recent, remember, clear }
}

export type DirectoryList = {
  path: string
  parent?: string
  entries: Array<{ name: string; path: string }>
}

export type WorkspaceFileIndex = {
  files: string[]
  ensureLoaded: () => void
  refresh: () => void
  enabled: boolean
}

/**
 * Lazily loads a flat file index for `@`-mention autocomplete. The index
 * is fetched on first {@link WorkspaceFileIndex.ensureLoaded} call and can
 * be refreshed in the background while the previous file list remains usable.
 */
function useLazyFileIndex(
  key: string | null,
  enabled: boolean,
  load: (key: string) => Promise<{ files: string[]; truncated: boolean }>,
): WorkspaceFileIndex {
  const [files, setFiles] = useState<string[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const initialized = useRef(false)
  const loadingFor = useRef<string | null>(null)
  const requestId = useRef(0)
  const lastRefreshAt = useRef(0)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      return
    }
    setFiles([])
    setLoadedFor(null)
  }, [key])

  const loadIndex = useCallback(
    (force: boolean) => {
      if (!enabled || !key || loadingFor.current === key) return
      if (!force && loadedFor === key) return

      const now = Date.now()
      if (
        force &&
        loadedFor === key &&
        now - lastRefreshAt.current < FILE_INDEX_RESCAN_COOLDOWN_MS
      ) {
        return
      }

      if (force) lastRefreshAt.current = now
      loadingFor.current = key
      const currentRequestId = ++requestId.current
      const currentKey = key

      load(currentKey)
        .then((result) => {
          if (requestId.current !== currentRequestId) return
          setFiles(result.files)
          setLoadedFor(currentKey)
          lastRefreshAt.current = Date.now()
        })
        .catch((err) => {
          if (requestId.current !== currentRequestId) return
          toast(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (requestId.current === currentRequestId) loadingFor.current = null
        })
    },
    [enabled, key, loadedFor, load],
  )

  const ensureLoaded = useCallback(() => {
    loadIndex(false)
  }, [loadIndex])

  const refresh = useCallback(() => {
    loadIndex(true)
  }, [loadIndex])

  return {
    files: loadedFor === key ? files : [],
    ensureLoaded,
    refresh,
    enabled: enabled && Boolean(key),
  }
}

/** File index for an active session. */
export function useWorkspaceFileIndex(
  sessionId: Id<'sessions'> | undefined,
  enabled: boolean,
): WorkspaceFileIndex {
  const listFiles = useAction(api.actions.workspaces.listFiles)
  const load = useCallback(
    (id: string) => listFiles({ sessionId: id as Id<'sessions'> }),
    [listFiles],
  )
  return useLazyFileIndex(sessionId ?? null, enabled, load)
}

/** File index that works without an active session. */
export function useWorkspaceFileIndexByRoot(
  root: string | null,
): WorkspaceFileIndex {
  const isAdmin = useIsWorkspaceAdmin()
  const listFilesByRoot = useAction(api.actions.workspaces.listFilesByRoot)
  const load = useCallback(
    (value: string) => listFilesByRoot({ root: value }),
    [listFilesByRoot],
  )
  return useLazyFileIndex(root, isAdmin, load)
}

export function useWorkspaceBrowser() {
  const listDirectories = useAction(api.actions.workspaces.listDirectories)
  const [path, setPath] = useState('')
  const [list, setList] = useState<DirectoryList | null>(null)
  const [busy, setBusy] = useState(false)

  const loadDirectories = useCallback(
    async (nextPath?: string) => {
      setBusy(true)
      try {
        const result = await listDirectories(nextPath ? { path: nextPath } : {})
        setList(result)
        setPath(result.path)
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [listDirectories],
  )

  return { path, setPath, list, busy, loadDirectories }
}
