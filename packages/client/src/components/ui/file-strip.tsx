import { type FileItem, useFilePreviews } from '@/hooks/file-previews'
import { cn } from '@/lib/utils'
import { truncateToExtension } from '@sb/core/utils/strings'
import { FileIcon, XIcon } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useRef } from 'react'

import { FilterableList, RippleButton, Skeleton, useLightbox } from '../ui'
import type { FilterableListProps } from '../ui'

const DEFAULT_SIZE = 120

export type FileStripProps = Omit<
  FilterableListProps<FileItem>,
  'items' | 'keys' | 'empty' | 'placeholder' | 'render'
> & {
  files: FileItem[]
  onRemove?: (url: string) => void
  size?: number
  noAnimation?: boolean
}

export function FileStrip(props: FileStripProps) {
  const {
    className,
    files,
    onRemove,
    size = DEFAULT_SIZE,
    noAnimation = false,
    ...rest
  } = props
  const previews = useFilePreviews(files)
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
      items={[...files].reverse()}
      keys={(item) => item.url}
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
        'flex w-full items-start gap-4 overflow-x-auto p-4',
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
      initial={noAnimation ? undefined : { height: 0, opacity: 0 }}
      animate={noAnimation ? undefined : { height: 'auto', opacity: 1 }}
      exit={noAnimation ? undefined : { height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      render={(item) => {
        const preview = previews?.find((p) => p.previewUrl === item.url)
        return (
          <div
            className="relative shrink-0"
            style={{ width: size, height: size }}
          >
            {preview?.thumbnailUrl ? (
              <Thumbnail
                src={preview.url}
                thumbnailSrc={preview.thumbnailUrl}
                alt={item.file.name}
              />
            ) : preview?.isThumbnailable ? (
              <Skeleton className="size-full shrink-0 rounded-lg" />
            ) : (
              <UnknownFile name={item.file.name} />
            )}
            <RemoveButton item={item} onRemove={onRemove} />
          </div>
        )
      }}
      {...rest}
    />
  )

  if (noAnimation) return list || null
  return <AnimatePresence mode="wait">{list}</AnimatePresence>
}

function Thumbnail({
  src,
  thumbnailSrc,
  alt,
}: {
  src: string
  thumbnailSrc: string
  alt: string
}) {
  const lightbox = useLightbox()

  return (
    // biome-ignore lint/performance/noImgElement: local
    <img
      src={thumbnailSrc}
      alt={alt}
      onClick={() => lightbox?.open(src, alt)}
      className="border-input size-full shrink-0 cursor-zoom-in rounded-lg border object-cover"
    />
  )
}

function UnknownFile({ name }: { name: string }) {
  return (
    <div className="bg-m3-surface-container-high/70 border-input flex size-full items-center justify-center rounded-lg border">
      <div className="flex flex-col items-center gap-1">
        <FileIcon className="text-m3-on-surface-variant size-6" />
        <span className="text-m3-on-surface-variant max-w-20 truncate text-xs">
          {truncateToExtension(name, 12)}
        </span>
      </div>
    </div>
  )
}

function RemoveButton({
  item,
  onRemove,
}: {
  item: FileItem
  onRemove?: (url: string) => void
}) {
  if (!onRemove) return null

  return (
    <RippleButton
      size="icon"
      variant="surface"
      onClick={() => onRemove(item.url)}
      className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full"
      aria-label={`Remove file ${item.file.name}`}
    >
      <XIcon className="size-3" />
    </RippleButton>
  )
}
