import { isDisplayableUrl, thumbnail } from '@/lib/io'
import { isKnownTextFile } from '@cv/core/workspace/files'
import { useEffect, useRef, useState } from 'react'

export type FileItem = {
  id: string
  url: string
  file: File
  originalUrl?: string
  permaUrl?: string
  byteLength?: number
  canInsertInline?: boolean
  localPreview?: LocalFilePreview
}

export type LocalFilePreview = {
  url: string
  thumbnail?: Promise<string | null>
  thumbnailUrl?: string | null
}

export type FilePreview = {
  url: string
  previewUrl: string
  isThumbnailable: boolean
  thumbnailUrl: string | null
}

function previewSources(items: FileItem[]) {
  const sources = new Map<string, LocalFilePreview | undefined>()
  for (const item of items) {
    if (isTextFileItem(item)) continue
    if (isDisplayableUrl(item.url) && !sources.has(item.url)) {
      sources.set(item.url, undefined)
    }
    if (item.localPreview) sources.set(item.localPreview.url, item.localPreview)
  }
  return sources
}

function localThumbnail(preview: LocalFilePreview) {
  // The composer already resized local images for display.
  if (preview.url.startsWith('data:image/')) return preview.url
  return preview.thumbnailUrl
}

function loadThumbnail(url: string, local?: LocalFilePreview) {
  if (!local) return thumbnail(url)
  local.thumbnail ??= thumbnail(url).then((result) => {
    local.thumbnailUrl = result
    return result
  })
  return local.thumbnail
}

/** Identifies file strip entries that can be opened in the text viewer. */
export function isTextFileItem(item: FileItem): boolean {
  const mediaType = item.file.type.split(';', 1)[0]?.toLowerCase()
  return (
    !mediaType.startsWith('image/') &&
    isKnownTextFile(item.file.type, item.file.name)
  )
}

export function useFilePreviews(items: FileItem[]): FilePreview[] {
  const [thumbnailMap, setThumbnailMap] = useState<Map<string, string | null>>(
    new Map(),
  )
  const inflightRef = useRef<Map<string, AbortController>>(new Map())
  const finishedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const sources = previewSources(items)

    for (const [url, controller] of inflightRef.current.entries()) {
      if (!sources.has(url)) {
        controller.abort()
        inflightRef.current.delete(url)
        finishedRef.current.delete(url)
      }
    }

    for (const [url, local] of sources) {
      if (local && localThumbnail(local) !== undefined) continue
      if (inflightRef.current.has(url) || finishedRef.current.has(url)) continue

      const controller = new AbortController()
      inflightRef.current.set(url, controller)

      loadThumbnail(url, local)
        .then((thumbnailUrl) => {
          if (controller.signal.aborted) return
          finishedRef.current.add(url)
          setThumbnailMap((prev) => {
            const next = new Map(prev)
            next.set(url, thumbnailUrl)
            return next
          })
        })
        .finally(() => {
          if (inflightRef.current.get(url) === controller) {
            inflightRef.current.delete(url)
          }
        })
    }
  }, [items])

  return items.map((item) => {
    if (isTextFileItem(item)) {
      return {
        url: item.originalUrl ?? item.url,
        previewUrl: item.url,
        isThumbnailable: false,
        thumbnailUrl: null,
      }
    }

    const pending = !isDisplayableUrl(item.url)
    const result = thumbnailMap.get(item.url)
    const fallback = item.localPreview && localThumbnail(item.localPreview)
    const thumbnailUrl = result ?? fallback ?? null
    const awaitingThumbnail = result === undefined && !item.localPreview
    return {
      url: item.originalUrl ?? item.url,
      previewUrl: item.url,
      isThumbnailable: pending || thumbnailUrl !== null || awaitingThumbnail,
      thumbnailUrl,
    }
  })
}
