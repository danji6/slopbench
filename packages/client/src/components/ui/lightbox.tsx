import { createOptionalContext } from '@/hooks'
import { getFocusReturnTarget } from '@/lib/focus-return'
import { cn } from '@/lib/utils'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { Dialog } from './dialog'
import { LoadingIndicator } from './loading-indicator'
import { RippleButton } from './ripple-button'

export type LightboxEntry = {
  id: string
  src: string
  alt?: string
  kind: 'image' | 'video'
  poster?: string
}

type LightboxControls = {
  open: (src: string, alt?: string) => void
  openGallery: (
    entries: LightboxEntry[],
    selectedId: string,
    trigger?: HTMLElement,
  ) => void
}

type Gallery = { entries: LightboxEntry[]; index: number }

const [LightboxContext, useLightbox] = createOptionalContext<LightboxControls>()

export { useLightbox }

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [gallery, setGallery] = useState<Gallery | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const openGallery = useCallback<LightboxControls['openGallery']>(
    (entries, selectedId, trigger) => {
      const index = entries.findIndex(({ id }) => id === selectedId)
      if (index < 0) return

      const active = document.activeElement
      triggerRef.current =
        trigger ?? (active instanceof HTMLElement ? active : null)
      setGallery({ entries, index })
    },
    [],
  )

  const open = useCallback(
    (src: string, alt?: string) => {
      openGallery([{ id: src, src, alt, kind: 'image' }], src)
    },
    [openGallery],
  )

  return (
    <LightboxContext.Provider value={{ open, openGallery }}>
      {children}
      <LightboxDialog
        gallery={gallery}
        onChange={setGallery}
        returnFocus={() => {
          const trigger = triggerRef.current
          if (trigger?.isConnected && !trigger.closest('[inert]'))
            return trigger
          return getFocusReturnTarget()
        }}
      />
    </LightboxContext.Provider>
  )
}

type LightboxDialogProps = {
  gallery: Gallery | null
  onChange: React.Dispatch<React.SetStateAction<Gallery | null>>
  returnFocus: () => HTMLElement | null
}

function LightboxDialog({
  gallery,
  onChange,
  returnFocus,
}: LightboxDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const entry = gallery?.entries[gallery.index]
  const hasNeighbors = (gallery?.entries.length ?? 0) > 1

  function move(offset: number) {
    onChange((current) => {
      if (!current) return current
      const index = current.index + offset
      return current.entries[index] ? { ...current, index } : current
    })
  }

  function handleKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onChange(null)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      move(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(next) => !next && onChange(null)}>
      <Dialog.Content
        aria-label="Media viewer"
        data-slot="media-viewer"
        showCloseButton={false}
        initialFocus={closeRef}
        finalFocus={returnFocus}
        className="inset-0 z-70 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 rounded-none border-0 bg-black/80 p-0 backdrop-blur-sm"
        onKeyDownCapture={handleKey}
        onClick={(event) => {
          if (event.target === event.currentTarget) onChange(null)
        }}
      >
        {entry?.kind === 'image' && (
          <LightboxImage key={entry.id} entry={entry} />
        )}
        {entry?.kind === 'video' && (
          <LightboxVideo key={entry.id} entry={entry} />
        )}
        {gallery && hasNeighbors && (
          <>
            <GalleryArrow
              direction="previous"
              disabled={gallery.index === 0}
              onClick={() => move(-1)}
            />
            <GalleryArrow
              direction="next"
              disabled={gallery.index === gallery.entries.length - 1}
              onClick={() => move(1)}
            />
          </>
        )}
        <RippleButton
          ref={closeRef}
          variant="stealth"
          size="icon"
          aria-label="Close"
          className="absolute top-4 right-4"
          onClick={() => onChange(null)}
        >
          <XIcon className="size-5" />
        </RippleButton>
      </Dialog.Content>
    </Dialog>
  )
}

type GalleryArrowProps = {
  direction: 'previous' | 'next'
  disabled: boolean
  onClick: () => void
}

function GalleryArrow({ direction, disabled, onClick }: GalleryArrowProps) {
  const previous = direction === 'previous'
  const Icon = previous ? ChevronLeftIcon : ChevronRightIcon
  return (
    <RippleButton
      variant="stealth"
      size="icon"
      aria-label={previous ? 'Previous media' : 'Next media'}
      aria-disabled={disabled}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 aria-disabled:opacity-40',
        previous ? 'left-2 sm:left-4' : 'right-2 sm:right-4',
      )}
      onClick={disabled ? undefined : onClick}
    >
      <Icon className="size-6" />
    </RippleButton>
  )
}

function LightboxImage({ entry }: { entry: LightboxEntry }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  if (status === 'error') return <LightboxError alt={entry.alt} />

  return (
    <>
      {status === 'loading' && (
        <LoadingIndicator size={48} className="pointer-events-none absolute" />
      )}
      <img
        src={entry.src}
        alt={entry.alt ?? ''}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
        className={cn(
          'max-h-[90dvh] max-w-[90vw] rounded-xl object-contain shadow-2xl transition-opacity select-none',
          status === 'loading' && 'opacity-0',
        )}
      />
    </>
  )
}

function LightboxVideo({ entry }: { entry: LightboxEntry }) {
  const [status, setStatus] = useState<
    'loading' | 'manual' | 'ready' | 'error'
  >('loading')
  const [videoSize, setVideoSize] = useState<{ width: number; ratio: number }>()

  const startPlayback = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return
    let attached = true
    video.muted = true
    void video.play().catch(() => {
      if (!attached) return
      setStatus((current) => (current === 'loading' ? 'manual' : current))
    })
    return () => {
      attached = false
      video.pause()
    }
  }, [])

  if (status === 'error') return <LightboxError alt={entry.alt} />

  return (
    <div className="relative isolate grid place-items-center overflow-hidden rounded-xl bg-black shadow-2xl">
      {entry.poster && (
        <img
          data-slot="lightbox-video-preview"
          src={entry.poster}
          alt=""
          className={cn(
            'pointer-events-none absolute inset-0 z-10 size-full scale-105 object-cover blur-md transition-opacity motion-reduce:transition-none',
            status !== 'loading' && 'opacity-0',
          )}
        />
      )}
      <video
        ref={startPlayback}
        src={entry.src}
        aria-label={entry.alt}
        controls
        playsInline
        preload="auto"
        onLoadedMetadata={({ currentTarget }) => {
          const { videoWidth, videoHeight } = currentTarget
          if (!videoWidth || !videoHeight) return
          setVideoSize({ width: videoWidth, ratio: videoWidth / videoHeight })
        }}
        onLoadedData={() => setStatus('ready')}
        onPlaying={() => setStatus('ready')}
        onError={() => setStatus('error')}
        className="relative block max-h-[90dvh] max-w-[90vw] object-contain"
        style={
          videoSize && {
            width: `min(${videoSize.width}px, 90vw, ${90 * videoSize.ratio}dvh)`,
            aspectRatio: videoSize.ratio,
          }
        }
      />
      {status === 'loading' && (
        <LoadingIndicator
          size={48}
          className="pointer-events-none absolute z-20"
        />
      )}
    </div>
  )
}

function LightboxError({ alt }: { alt?: string }) {
  return (
    <p role="status" className="text-white">
      Could not load {alt || 'media'}
    </p>
  )
}
