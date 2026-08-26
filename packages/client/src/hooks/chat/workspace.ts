import { toastError } from '@/lib/notifications'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useAction } from 'convex/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
          toastError(err)
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
  const [showHidden, setShowHidden] = useState(false)
  const [history, setHistory] = useState<string[]>([])
  const currentRef = useRef<string | null>(null)

  const show = useCallback((result: DirectoryList) => {
    currentRef.current = result.path
    setList(result)
    setPath(result.path)
  }, [])

  const fetchList = useCallback(
    async (nextPath?: string) =>
      listDirectories({ path: nextPath, showHidden }),
    [listDirectories, showHidden],
  )

  // Lists `nextPath`, or the sidecar's default directory.
  // `fallback` retries from the default when the requested path is gone.
  // `record` pushes the previous directory onto the back history.
  const load = useCallback(
    async (nextPath?: string, fallback = false, record = true) => {
      const from = currentRef.current
      setBusy(true)
      try {
        const result = await fetchList(nextPath)
        if (record && from && from !== result.path) {
          setHistory((h) => [...h, from])
        }
        show(result)
      } catch (err) {
        toastError(err)
        if (nextPath && fallback) {
          try {
            show(await fetchList())
          } catch {
            // no op
          }
        }
      } finally {
        setBusy(false)
      }
    },
    [fetchList, show],
  )

  const loadDirectories = useCallback(
    (nextPath?: string, fallback = false) => load(nextPath, fallback),
    [load],
  )

  const goBack = useCallback(() => {
    const target = history.at(-1)
    if (!target || busy) return
    setHistory((h) => h.slice(0, -1))
    void load(target, false, false)
  }, [busy, history, load])

  const goUp = useCallback(() => {
    const parent = list?.parent
    if (!parent) return
    void load(parent)
  }, [list, load])

  const goHome = useCallback(() => {
    void load('~')
  }, [load])

  // Refetch the current listing when hidden entry visibility flips
  const prevHidden = useRef(showHidden)
  useEffect(() => {
    if (prevHidden.current === showHidden) return
    prevHidden.current = showHidden
    if (!currentRef.current) return
    void load(currentRef.current, false, false)
  }, [load, showHidden])

  return {
    path,
    setPath,
    list,
    busy,
    loadDirectories,
    showHidden,
    toggleShowHidden: useCallback(() => setShowHidden((v) => !v), []),
    canGoBack: history.length > 0,
    goBack,
    goUp,
    goHome,
  }
}
