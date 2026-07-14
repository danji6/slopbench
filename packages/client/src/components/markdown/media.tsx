
import { type AltMetadata, useAltMetadata } from '@/hooks'
import { cn, isVideo } from '@/lib/utils'
import { useEffect, useMemo } from 'react'

import { Card, Image, T, Video } from '../ui'
import { useLightbox } from '../ui/lightbox'
import { MarkdownCard, MarkdownCardFooter } from './card'
import { useMarkdown } from './context'

type MdImageProps = React.ComponentProps<'img'> & AltMetadata

type MdVideoProps = AltMetadata &
  React.ComponentProps<'video'> & {
    alt?: string
  }

export function MarkdownMedia({
  src,
  alt,
  node: _node,
  ref: _ref,
  video,
  ...props
}: {
  video?: boolean
} & React.ComponentProps<'img'> & { node?: unknown }) {
  const { thumbnail: _thumbnail, banner, hidden, ...meta } = useAltMetadata(alt)
  const { setBanner } = useMarkdown()

  const style: Record<string, string> = { maxWidth: '100%' }

  if (meta.width) {
    style.width = `min(${meta.width}px, 100%)`
  }

  if (meta.float) {
    style.float = meta.float
  }

  useEffect(() => {
    if (banner) {
      setBanner?.(src)
    }

    return () => {
      if (banner) {
        setBanner?.(undefined)
      }
    }
  }, [banner, src, setBanner])

  const _isVideo = useMemo(() => video || isVideo(src), [src, video])

  if (hidden) {
    return null
  }

  if (meta.float) {
    return _isVideo ? (
      <MarkdownFloatingVideo
        src={src as string}
        {...(props as React.ComponentProps<'video'>)}
        {...meta}
        style={style}
      />
    ) : (
      <MarkdownFloatingImage src={src} {...props} {...meta} style={style} />
    )
  }

  return _isVideo ? (
    <MarkdownVideo
      src={src as string}
      {...(props as React.ComponentProps<'video'>)}
      {...meta}
      style={style}
    />
  ) : (
    <MarkdownImage src={src} {...props} {...meta} style={style} />
  )
}

function MarkdownImage({
  alt,
  description,
  width,
  height,
  objectFit,
  objectPosition,
  imageRendering,
  backgroundColor,
  className,
  style,
  src,
  ...props
}: MdImageProps) {
  const lightbox = useLightbox()

  function handleClick() {
    if (typeof src === 'string' && lightbox) {
      lightbox.open(src, description || alt)
    }
  }

  return (
    <MarkdownCard
      className={cn(
        'not-first:mt-6',
        className,
        lightbox && src && 'cursor-zoom-in',
      )}
      style={style}
      onClick={handleClick}
    >
      <Card.Media
        style={{
          backgroundColor,
          height:
            objectFit === 'contain'
              ? 'fit-content'
              : height
                ? `${height}px`
                : 'auto',
        }}
      >
        <Card.Image
          src={src}
          width={width}
          height={height}
          alt={description || alt || 'Embedded image'}
          style={{ objectFit, objectPosition, imageRendering }}
          className="relative mx-auto"
          fill={false}
          {...props}
        />
      </Card.Media>
      {description && (
        <MarkdownCardFooter>
          <T.muted className="text-sm italic">{description}</T.muted>
        </MarkdownCardFooter>
      )}
    </MarkdownCard>
  )
}

function MarkdownFloatingImage({
  alt,
  description,
  height: _height,
  float: _float,
  objectFit,
  objectPosition,
  imageRendering,
  backgroundColor: _backgroundColor,
  className: _className,
  style,
  ...props
}: MdImageProps) {
  return (
    <Image
      alt={description || alt || 'Embedded image'}
      title={description || alt || 'Embedded image'}
      style={{
        ...style,
        objectFit,
        objectPosition,
        imageRendering,
      }}
      className="relative mx-3 mt-2 rounded-xl"
      {...props}
    />
  )
}

function MarkdownVideo({
  alt,
  description,
  height,
  objectFit,
  objectPosition,
  imageRendering,
  backgroundColor,
  className,
  style,
  ...props
}: MdVideoProps) {
  return (
    <MarkdownCard className={cn('not-first:mt-6', className)} style={style}>
      <Card.Media
        style={{
          backgroundColor,
          height:
            objectFit === 'contain'
              ? 'fit-content'
              : height
                ? `${height}px`
                : undefined,
        }}
      >
        <Card.Video
          title={description || alt || 'Embedded video'}
          style={{ objectFit, objectPosition, imageRendering }}
          className="mx-auto"
          {...props}
        />
      </Card.Media>
      {description && (
        <MarkdownCardFooter>
          <T.muted className="text-sm italic">{description}</T.muted>
        </MarkdownCardFooter>
      )}
    </MarkdownCard>
  )
}

function MarkdownFloatingVideo({
  alt,
  description,
  height: _height,
  float: _float,
  objectFit,
  objectPosition,
  backgroundColor: _backgroundColor,
  className: _className,
  style,
  ...props
}: MdVideoProps) {
  return (
    <Video
      title={description || alt || 'Embedded video'}
      style={{
        ...style,
        objectFit,
        objectPosition,
      }}
      className="relative mx-3 mt-2 rounded-xl border"
      {...props}
    />
  )
}
