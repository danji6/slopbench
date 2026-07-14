import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { type VariantProps, cva } from 'class-variance-authority'

const itemVariants = cva(
  'bg-m3-surface-container group/item [a]:hover:bg-m3-surface-container-high focus-visible:border-ring focus-visible:ring-ring flex flex-wrap items-center rounded-md border border-transparent text-sm transition-colors duration-100 outline-none focus-visible:ring-1 [a]:transition-colors',
  {
    variants: {
      variant: {
        default: '',
        outline: 'border-border',
        muted: 'bg-muted/50',
      },
      size: {
        default: 'gap-4 p-4',
        sm: 'gap-2.5 px-4 py-3',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

const itemMediaVariants = cva(
  'flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'relative bg-transparent',
        icon: "bg-muted size-8 rounded-sm border [&_svg:not([class*='size-'])]:size-4",
        image:
          'relative size-20 overflow-hidden rounded-xl [&_img]:size-full [&_img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn('my-0', className)}
      {...props}
    />
  )
}

function ItemRoot({
  className,
  variant = 'default',
  size = 'default',
  render,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof itemVariants> & { render?: useRender.RenderProp }) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps(
      {
        'data-slot': 'item',
        'data-variant': variant,
        'data-size': size,
        className: cn(itemVariants({ variant, size, className })),
      },
      props,
    ),
  })
}

function ItemMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        'flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none',
        className,
      )}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        'flex w-fit items-center gap-2 text-sm leading-snug font-medium',
        className,
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        'text-muted-foreground line-clamp-2 text-sm leading-normal font-normal text-balance',
        '[&>a:hover]:text-primary [&>a]:underline [&>a]:underline-offset-4',
        className,
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-actions"
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        'flex basis-full items-center justify-between gap-2',
        className,
      )}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        'flex basis-full items-center justify-between gap-2',
        className,
      )}
      {...props}
    />
  )
}

export const Item = {
  Root: ItemRoot,
  Media: ItemMedia,
  Content: ItemContent,
  Actions: ItemActions,
  Separator: ItemSeparator,
  Title: ItemTitle,
  Description: ItemDescription,
  Header: ItemHeader,
  Footer: ItemFooter,
}
