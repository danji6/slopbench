import { cn } from '@/lib/utils'
import type * as React from 'react'

import {
  Image,
  type ImageProps,
  MediaContainer,
  Video,
  type VideoProps,
} from '.'

function CardRoot({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-card text-card-foreground flex max-w-full flex-col gap-6 rounded-xl border py-6 has-data-[slot=card-media]:pt-0',
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-semibold', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-6', className)}
      {...props}
    />
  )
}

function CardMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <MediaContainer
      data-slot="card-media"
      className={cn(
        'bg-m3-surface-container relative h-50 w-full rounded-t-xl rounded-b-2xl border-0',
        className,
      )}
      {...props}
    />
  )
}

function CardImage({ className, ...props }: ImageProps) {
  return (
    <Image
      data-slot="card-image"
      className={cn('size-full object-cover', className)}
      {...props}
    />
  )
}

function CardVideo({ className, ...props }: VideoProps) {
  return (
    <Video
      data-slot="card-video"
      className={cn('size-full', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  )
}

export const Card = {
  Root: CardRoot,
  Header: CardHeader,
  Footer: CardFooter,
  Title: CardTitle,
  Action: CardAction,
  Description: CardDescription,
  Content: CardContent,
  Media: CardMedia,
  Image: CardImage,
  Video: CardVideo,
}
