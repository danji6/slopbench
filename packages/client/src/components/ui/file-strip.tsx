import {
  type FileItem,
  type FilePreview,
  isTextFileItem,
  useFilePreviews,
} from '@/hooks/file-previews'
import { ACCEPTED_VIDEO_TYPES, isDisplayableUrl } from '@/lib/io'
import { toast, toastError } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import {
  attachmentMarkdownLink,
  attachmentReference,
} from '@sb/core/attachments'
import { formatByteLength } from '@sb/core/utils/size'
import { truncateToExtension } from '@sb/core/utils/strings'
import {
  DownloadIcon,
  FileIcon,
  LinkIcon,
  TextCursorInputIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'

import { FilterableList, RippleButton, Skeleton } from '../ui'
import type { FilterableListProps } from '../ui'
import { type LightboxEntry, useLightbox } from './lightbox'
import { TextFileViewer } from './text-file-viewer'

const DEFAULT_SIZE = 120

export type FileStripProps = Omit<
  FilterableListProps<FileItem>,
  'items' | 'keys' | 'empty' | 'placeholder' | 'render'
> & {
  files: FileItem[]
  onRemove?: (id: string) => void
  onInsertInline?: (id: string) => void
  size?: number
  noAnimation?: boolean
}

export function FileStrip(props: FileStripProps) {
  const {
    className,
    files,
    onRemove,
    onInsertInline,
    size = DEFAULT_SIZE,
    noAnimation = false,
    ...rest
  } = props
  const previews = useFilePreviews(files)
  const lightbox = useLightbox()
  const previewsById = new Map(
    files.map((item, index) => {
      const preview = previews[index]
      return [item.id, { preview, media: galleryEntry(item, preview) }]
    }),
  )
  const gallery = [...previewsById.values()].flatMap(({ media }) =>
    media ? [media] : [],
  )
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollLeft = 0
    }
  }, [])

  const list = files.length > 0 && (
    <FilterableList<FileItem>
      data-slot="file-strip"
      ref={listRef}
      items={files}
      keys={(item) => item.id}
      empty={() => null}
      placeholder={[
        files.length,
        () => (
          <div
            className="bg-m3-surface-container-highest rounded-lg"
            style={{ width: size, height: size }}
          />
        ),
      ]}
      className={cn(
        'flex w-full items-start gap-4 overflow-x-auto overflow-y-hidden p-4',
        className,
      )}
      itemProps={
        noAnimation
          ? undefined
          : {
              initial: { scale: 0.8, opacity: 0 },
              animate: { scale: 1, opacity: 1 },
              exit: { scale: 0.5, opacity: 0 },
            }
      }
      render={(item) => {
        const { preview, media } = previewsById.get(item.id)!
        return (
          <div
            className="relative shrink-0"
            style={{ width: size, height: size }}
          >
            {media ? (
              <MediaThumbnail
                src={
                  media.kind === 'video'
                    ? media.poster
                    : (preview?.thumbnailUrl ?? undefined)
                }
                video={media.kind === 'video'}
                alt={item.file.name}
                onOpen={
                  lightbox
                    ? (trigger) =>
                        lightbox.openGallery(gallery, item.id, trigger)
                    : undefined
                }
              />
            ) : preview.isThumbnailable && !preview.thumbnailUrl ? (
              <Skeleton className="size-full shrink-0 rounded-lg" />
            ) : isTextFileItem(item) ? (
              <TextFileViewer item={item}>
                <UnknownFile
                  name={item.file.name}
                  byteLength={item.byteLength ?? item.file.size}
                />
              </TextFileViewer>
            ) : (
              <UnknownFile
                name={item.file.name}
                byteLength={item.byteLength ?? item.file.size}
              />
            )}
            <RemoveButton item={item} onRemove={onRemove} />
            {(item.byteLength ?? item.file.size) > 0 &&
              preview?.thumbnailUrl && (
                <span className="bg-m3-surface-container/90 absolute top-1 left-1 rounded-full px-2 py-0.5 text-[10px]">
                  {formatByteLength(item.byteLength ?? item.file.size)}
                </span>
              )}
            <FileActions item={item} onInsertInline={onInsertInline} />
          </div>
        )
      }}
      {...rest}
    />
  )

  if (noAnimation) return list || null
  return (
    <AnimatePresence mode="wait">
      {list && (
        <motion.div
          className="w-full shrink-0 overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          {list}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function FileActions({
  item,
  onInsertInline,
}: {
  item: FileItem
  onInsertInline?: (id: string) => void
}) {
  const downloadUrl = item.permaUrl ?? item.originalUrl
  const reference = item.permaUrl ? attachmentReference(item.permaUrl) : null
  const copyText = reference
    ? attachmentMarkdownLink(reference.token, reference.filename)
    : null
  if (!downloadUrl && !item.canInsertInline) return null

  return (
    <div className="absolute right-1 bottom-1 flex gap-1">
      {item.canInsertInline && onInsertInline && (
        <RippleButton
          size="icon"
          variant="surface"
          className="size-7 rounded-full"
          aria-label={`Insert ${item.file.name} inline`}
          onClick={() => onInsertInline(item.id)}
        >
          <TextCursorInputIcon className="size-3" />
        </RippleButton>
      )}
      {copyText && (
        <RippleButton
          size="icon"
          variant="surface"
          className="size-7 rounded-full"
          aria-label={`Copy link to ${item.file.name}`}
          onClick={() => {
            void navigator.clipboard
              .writeText(copyText)
              .then(() => toast.success('Attachment link copied'))
              .catch((error) =>
                toastError(error, 'Failed to copy attachment link'),
              )
          }}
        >
          <LinkIcon className="size-3" />
        </RippleButton>
      )}
      {downloadUrl && (
        <RippleButton
          size="icon"
          variant="surface"
          className="size-7 rounded-full"
          aria-label={`Download ${item.file.name}`}
          render={<a href={downloadUrl} download={item.file.name} />}
        >
          <DownloadIcon className="size-3" />
        </RippleButton>
      )}
    </div>
  )
}

function galleryEntry(
  item: FileItem,
  preview: FilePreview,
): LightboxEntry | null {
  if (!isDisplayableUrl(preview.url) || isTextFileItem(item)) return null

  const mime = item.file.type.split(';', 1)[0]
  const filename = item.file.name.toLowerCase()
  const unknownType = !mime || mime === 'application/octet-stream'
  const matchesExtension = (extension: string) =>
    filename.endsWith(`.${extension}`)
  const video = ACCEPTED_VIDEO_TYPES.some(
    ({ mime: type, extensions }) =>
      mime === type || (unknownType && extensions.some(matchesExtension)),
  )
  const { url: src, thumbnailUrl } = preview
  const entry = { id: item.id, src, alt: item.file.name }

  if (video) {
    const poster =
      thumbnailUrl !== item.url ? (thumbnailUrl ?? undefined) : undefined
    return { ...entry, kind: 'video', poster }
  }
  if (
    mime.startsWith('image/') ||
    (thumbnailUrl && !mime.startsWith('video/'))
  ) {
    return { ...entry, kind: 'image' }
  }
  return null
}

type MediaThumbnailProps = {
  src?: string
  video: boolean
  alt: string
  onOpen?: (trigger: HTMLElement) => void
}

function MediaThumbnail({ src, video, alt, onOpen }: MediaThumbnailProps) {
  const content = src ? (
    <img src={src} alt={alt} className="size-full object-cover" />
  ) : video ? (
    <span className="bg-m3-surface-container-high flex size-full items-center justify-center">
      <VideoIcon />
    </span>
  ) : (
    <Skeleton className="size-full rounded-lg" />
  )

  if (!onOpen) return content
  return (
    <button
      type="button"
      aria-label={`Open ${alt}`}
      className="border-input focus-visible:ring-ring block size-full cursor-zoom-in overflow-hidden rounded-lg border focus-visible:ring-2"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      {content}
    </button>
  )
}

function UnknownFile({
  name,
  byteLength,
}: {
  name: string
  byteLength: number
}) {
  return (
    <div className="bg-m3-surface-container-high/70 border-input flex size-full items-center justify-center rounded-lg border">
      <div className="flex flex-col items-center gap-1">
        <FileIcon className="text-m3-on-surface-variant size-6" />
        <span className="text-m3-on-surface-variant max-w-20 truncate text-xs">
          {truncateToExtension(name, 12)}
        </span>
        {byteLength > 0 && (
          <span className="text-m3-on-surface-variant/70 text-[10px]">
            {formatByteLength(byteLength)}
          </span>
        )}
      </div>
    </div>
  )
}

function RemoveButton({
  item,
  onRemove,
}: {
  item: FileItem
  onRemove?: (id: string) => void
}) {
  if (!onRemove) return null

  return (
    <RippleButton
      size="icon"
      variant="surface"
      onClick={() => onRemove(item.id)}
      className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full"
      aria-label={`Remove file ${item.file.name}`}
    >
      <XIcon className="size-3" />
    </RippleButton>
  )
}
