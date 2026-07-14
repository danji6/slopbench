import { cn } from '@/lib/utils'
import { UserIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

export type AvatarProps = {
  src?: string | null
  alt?: string
  fallbackIcon?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  noHover?: boolean
  className?: string
}

const sizeClasses = {
  sm: 'size-8',
  md: 'size-12',
  lg: 'size-20',
} as const

const iconSizeClasses = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-8',
} as const

export function Avatar({
  src,
  alt,
  fallbackIcon,
  size = 'md',
  onClick,
  noHover,
  className,
}: AvatarProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [loaded, setLoaded] = useState(false)

  // A cached image is already loaded by the time this runs
  useLayoutEffect(() => {
    const img = imgRef.current
    setLoaded(!!img?.complete && img.naturalWidth > 0)
  }, [src])

  return (
    <div
      data-slot="avatar"
      className={cn(
        'border-input bg-muted focus-visible:border-ring focus-visible:ring-ring relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border outline-0 transition-all focus-visible:ring-1',
        !noHover && 'hover:scale-105',
        sizeClasses[size],
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      <FallbackIcon
        fallbackIcon={fallbackIcon}
        iconSize={iconSizeClasses[size]}
      />
      {src && (
        <img
          ref={imgRef}
          src={src}
          alt={alt ?? ''}
          decoding="sync"
          className={cn(
            'absolute inset-0 size-full object-cover',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  )
}

function FallbackIcon({
  fallbackIcon,
  iconSize,
}: {
  fallbackIcon?: React.ReactNode
  iconSize: string
}) {
  return (
    <div
      className={cn(
        'text-muted-foreground absolute flex items-center justify-center',
        iconSize,
      )}
    >
      {fallbackIcon ?? <UserIcon className="size-full" />}
    </div>
  )
}
