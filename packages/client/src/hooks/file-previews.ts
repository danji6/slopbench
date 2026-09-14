import { isDisplayableUrl, thumbnail } from '@/lib/io'
import { isKnownTextFile } from '@sb/core/workspace/files'
import { useEffect, useRef, useState } from 'react'

export type FileItem = {
  url: string
  file: File
  originalUrl?: string
  permaUrl?: string
  byteLength?: number
  canInsertInline?: boolean
}

export type FilePreview = {
  url: string
  previewUrl: string
  isThumbnailable: boolean
  thumbnailUrl: string | null
}

type ThumbnailResult = {
  isThumbnailable: boolean
  thumbnailUrl: string | null
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
  const [thumbnailMap, setThumbnailMap] = useState<
    Map<string, ThumbnailResult>
  >(new Map())
  const inflightRef = useRef<Map<string, AbortController>>(new Map())
  const finishedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const currentUrls = new Set(items.map((i) => i.url))

    for (const [url, controller] of inflightRef.current.entries()) {
      if (!currentUrls.has(url)) {
        controller.abort()
        inflightRef.current.delete(url)
        finishedRef.current.delete(url)
      }
    }

    for (const item of items) {
      if (isTextFileItem(item)) continue
      if (!isDisplayableUrl(item.url)) continue
      if (
        inflightRef.current.has(item.url) ||
        finishedRef.current.has(item.url)
      ) {
        continue
      }

      const controller = new AbortController()
      inflightRef.current.set(item.url, controller)

      thumbnail(item.url)
        .then((thumbnailUrl) => {
          if (controller.signal.aborted) return
          finishedRef.current.add(item.url)
          setThumbnailMap((prev) => {
            const next = new Map(prev)
            next.set(item.url, {
              isThumbnailable: !!thumbnailUrl,
              thumbnailUrl,
            })
            return next
          })
        })
        .finally(() => {
          inflightRef.current.delete(item.url)
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
    return {
      url: item.originalUrl ?? item.url,
      previewUrl: item.url,
      isThumbnailable: pending ? true : (result?.isThumbnailable ?? true),
      thumbnailUrl: pending ? null : (result?.thumbnailUrl ?? null),
    }
  })
}
