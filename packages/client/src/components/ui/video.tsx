
import { cn, keyFor } from '@/lib/utils'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Skeleton } from './skeleton'

export type VideoProps = React.ComponentProps<'video'> & {
  playInView?: boolean
  width?: number
  height?: number
  fill?: boolean
  inline?: boolean
}

export function Video({
  playInView = true,
  width,
  height,
  fill,
  className,
  inline,
  ...props
}: VideoProps) {
  const [isLoaded, setLoaded] = useState(false)
  const ref = useRef<HTMLVideoElement | null>(null)
  const isInView = useInView(ref, { amount: 0.8 })
  const isFill = width || height ? false : (fill ?? false)
  const { src } = props

  useEffect(() => {
    if (ref.current && ref.current.readyState >= 1) {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!ref.current || !playInView) return
    const video = ref.current
    let playPromise: Promise<void> | undefined

    if (isInView && video.paused) {
      playPromise = video.play()
      playPromise?.catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Video play error:', error)
        }
      })
    } else {
      video.pause()
    }

    return () => {
      if (playPromise) {
        playPromise.catch(() => {})
      }
    }
  }, [playInView, isInView])

  return (
    <span
      key={useMemo(() => keyFor(src), [src])}
      data-slot="video-container"
      className={cn(
        'relative',
        !inline && 'block',
        isFill && 'absolute inset-0 size-full',
      )}
    >
      <motion.span
        data-slot="video-overlay"
        initial={{ opacity: 0, filter: 'blur(3px)' }}
        animate={
          isLoaded
            ? { opacity: 1, filter: 'blur(0px)' }
            : { opacity: 0, filter: 'blur(3px)' }
        }
        transition={{ duration: 0.3 }}
        className={cn('size-full', !inline && 'block')}
      >
        <video
          data-slot="video"
          ref={ref}
          playsInline
          autoPlay={playInView && isInView}
          muted
          loop
          width={width}
          height={height}
          className={cn(
            className,
            'object-contain',
            isFill && 'absolute inset-0 size-full object-cover',
          )}
          onLoadedMetadata={(e) => {
            setLoaded(true)
            props.onLoadedMetadata?.(e)
          }}
          onCanPlay={(e) => {
            setLoaded(true)
            props.onCanPlay?.(e)
          }}
          onCanPlayThrough={(e) => {
            setLoaded(true)
            props.onCanPlayThrough?.(e)
          }}
          onError={(e) => {
            setLoaded(true)
            props.onError?.(e)
          }}
          {...props}
        />
      </motion.span>
      <AnimatePresence>
        {!isLoaded && (
          <motion.span
            data-slot="video-placeholder"
            key="skeleton"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(3px)' }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0"
          >
            <Skeleton
              className={cn('size-full', className)}
              style={{
                width: width || undefined,
                height: height || undefined,
              }}
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}
