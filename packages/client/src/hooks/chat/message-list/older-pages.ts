import type {
  MessageStore,
  MessageWindowMetadata,
  WindowBoundary,
  WindowControls,
} from '@/lib/chat/message-store'
import {
  compareBoundaries,
  hasVisibleOlderContent,
  oldestLoadedBoundary,
} from '@/lib/chat/older-content'
import type { MessageRow } from '@/lib/chat/rows'
import { workExpansion } from '@/lib/chat/work-state'
import type { ScrollCoordinator } from '@/lib/scroll-coordinator'
import { scrollDebug } from '@/lib/scroll-debug'
import { useCallback, useEffect, useRef, useState } from 'react'

export type OlderPagesOptions = {
  sessionId: string | undefined
  rows: readonly MessageRow[]
  store: MessageStore
  meta: MessageWindowMetadata
  extendOlder: WindowControls['extendOlder']
  coordinator: ScrollCoordinator
  onCancel: () => void
}

type PendingOlderPages = {
  sessionId: string | undefined
  before: WindowBoundary
  revision: number
  navigation: number
  strict: boolean
  versions: Map<string, number>
  isCurrent: () => boolean
}

function loadedVersions(store: MessageStore) {
  return new Map(
    [...store.getMessageMetaMap()].map(([id, record]) => [
      id,
      record.selectedVersion,
    ]),
  )
}

function versionsChanged(pending: PendingOlderPages, store: MessageStore) {
  return [...pending.versions].some(([id, version]) => {
    const record = store.getMessageMetadata(id)
    return record !== undefined && record.selectedVersion !== version
  })
}

/** Continues bounded older requests until newly loaded body content is exposed. */
export function useOlderMessagePages({
  sessionId,
  rows,
  store,
  meta,
  extendOlder,
  coordinator,
  onCancel,
}: OlderPagesOptions) {
  const pending = useRef<PendingOlderPages | null>(null)
  const [active, setActive] = useState(false)
  const [sliding, setSliding] = useState(false)

  const finish = useCallback(() => {
    scrollDebug('older.done', () => ({
      before: pending.current?.before,
      revision: pending.current?.revision,
    }))
    pending.current = null
    setActive(false)
    setSliding(false)
  }, [])
  const cancel = useCallback(() => {
    if (!pending.current) return
    onCancel()
    finish()
  }, [finish, onCancel])

  const loadOlder = useCallback(() => {
    const busy = pending.current || meta.isLoadingOlder || meta.isLoadingNewer
    const before = oldestLoadedBoundary(store.getMessageMetaMap())
    if (busy || !meta.canLoadOlder || !before) return false
    scrollDebug('older.start', () => ({
      before,
      revision: meta.pageRevision,
    }))
    pending.current = {
      sessionId,
      before,
      revision: meta.pageRevision,
      navigation: meta.navigationRevision,
      strict: false,
      versions: loadedVersions(store),
      isCurrent: coordinator.checkpoint(),
    }
    setActive(true)
    setSliding(extendOlder())
    return true
  }, [meta, store, sessionId, coordinator, extendOlder])

  useEffect(() => {
    const request = pending.current
    if (!request) return
    const navigated =
      request.sessionId !== sessionId ||
      request.navigation !== meta.navigationRevision
    if (navigated || !request.isCurrent() || versionsChanged(request, store)) {
      scrollDebug('older.cancel', () => ({
        navigated,
        current: request.isCurrent(),
        versionsChanged: versionsChanged(request, store),
        revision: meta.pageRevision,
      }))
      cancel()
    }
  }, [rows, store, meta, sessionId, cancel])

  useEffect(() => {
    const request = pending.current
    if (!request) return
    if (meta.isLoadingOlder || meta.pageRevision === request.revision) return
    const visible = hasVisibleOlderContent(
      rows,
      request.before,
      store,
      workExpansion.getSnapshot(),
    )
    scrollDebug('older.page', () => ({
      before: request.before,
      oldest: oldestLoadedBoundary(store.getMessageMetaMap()),
      visible,
      strict: request.strict,
      revision: meta.pageRevision,
      hasOlder: meta.canLoadOlder,
    }))
    if (visible) {
      finish()
      return
    }
    const before = oldestLoadedBoundary(store.getMessageMetaMap())
    const advanced = before && compareBoundaries(before, request.before) < 0
    if (!meta.canLoadOlder || !before || (request.strict && !advanced)) {
      finish()
      return
    }
    request.strict = !advanced
    if (advanced) request.before = before
    request.revision = meta.pageRevision
    request.versions = loadedVersions(store)
    if (extendOlder(request.strict ? request.before : undefined))
      setSliding(true)
  }, [rows, store, meta, extendOlder, finish])

  useEffect(() => {
    if (!active) return
    const interrupt = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-load-older]')) {
        return
      }
      coordinator.interrupt()
      cancel()
    }
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const event of events) window.addEventListener(event, interrupt, true)
    return () => {
      for (const event of events) {
        window.removeEventListener(event, interrupt, true)
      }
    }
  }, [active, coordinator, cancel])

  useEffect(
    () => () => {
      pending.current = null
    },
    [],
  )

  return { loadOlder, cancel, isLoadingOlder: active, isSliding: sliding }
}
