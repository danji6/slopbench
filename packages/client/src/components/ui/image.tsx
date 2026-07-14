import { cn } from '@/lib/utils'
import { AnimatePresence, motion } from 'motion/react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Skeleton } from './skeleton'

export type ImageProps = {
  alt: string
  width?: number
  height?: number
  fill?: boolean
  className?: string
  inline?: boolean
  style?: React.CSSProperties
} & ({ src: string | Blob } | { src?: never })

export function Image({
  src,
  alt,
  width,
  height,
  fill,
  className,
  inline,
  style,
}: ImageProps) {
  const shouldFill = width || height ? false : (fill ?? false)
  const finalWidth = shouldFill ? undefined : (width ?? height ?? undefined)
  const finalHeight = shouldFill ? undefined : (height ?? width ?? undefined)

  const url = useMemo(() => {
    if (src instanceof Blob) {
      return URL.createObjectURL(src)
    }
    return src || ''
  }, [src])

  useEffect(() => {
    return () => {
      if (src instanceof Blob) {
        URL.revokeObjectURL(url)
      }
    }
  }, [src, url])

  if (!url) {
    return (
      <span
        data-slot="image-container"
        className={cn(
          'relative',
          !inline && 'block',
          shouldFill && 'absolute inset-0 size-full',
        )}
      >
        <Skeleton
          className={cn('size-full', className)}
          style={{
            width: finalWidth || undefined,
            height: finalHeight || undefined,
          }}
        />
      </span>
    )
  }

  return (
    <span
      data-slot="image-container"
      className={cn(
        'relative',
        !inline && 'block',
        shouldFill && 'absolute inset-0 size-full',
      )}
    >
      <ImageInner
        key={url}
        url={url}
        alt={alt}
        finalWidth={finalWidth}
        finalHeight={finalHeight}
        shouldFill={shouldFill}
        className={className}
        inline={inline}
        style={style}
      />
    </span>
  )
}

function ImageInner({
  url,
  alt,
  finalWidth,
  finalHeight,
  shouldFill,
  className,
  inline,
  style,
}: {
  url: string
  alt: string
  finalWidth?: number
  finalHeight?: number
  shouldFill: boolean
  className?: string
  inline?: boolean
  style?: React.CSSProperties
}) {
  const [isLoaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (imgRef.current?.complete) {
      setLoaded(true)
    }
  }, [])

  return (
    <>
      <motion.span
        data-slot="image-overlay"
        initial={{ opacity: 0, filter: 'blur(3px)' }}
        animate={
          isLoaded
            ? { opacity: 1, filter: 'blur(0px)' }
            : { opacity: 0, filter: 'blur(3px)' }
        }
        transition={{ duration: 0.3 }}
        className={cn('size-full', !inline && 'block')}
      >
        <img
          data-slot="image"
          ref={imgRef}
          src={url}
          alt={alt}
          loading="lazy"
          width={shouldFill ? undefined : (finalWidth ?? 0)}
          height={shouldFill ? undefined : (finalHeight ?? 0)}
          className={cn(
            className,
            'object-contain',
            shouldFill && 'absolute inset-0 size-full object-cover',
          )}
          style={{
            width: shouldFill ? '100%' : (!finalWidth ? '100%' : undefined),
            height: shouldFill ? '100%' : (!finalHeight ? 'auto' : undefined),
            ...style,
          }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      </motion.span>
      <AnimatePresence>
        {!isLoaded && (
          <motion.span
            data-slot="image-placeholder"
            key="skeleton"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(3px)' }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0"
          >
            <Skeleton
              className={cn('size-full', className)}
              style={{
                width: finalWidth || undefined,
                height: finalHeight || undefined,
              }}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </>
  )
}
