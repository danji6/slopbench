import { cn } from '@/lib/utils'

function h1({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'h1'>) {
  return (
    <h1
      className={cn(
        'mb-1 scroll-m-20 text-4xl font-bold tracking-tight',
        className,
      )}
      {...props}
    />
  )
}

function h2({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'h2'>) {
  return (
    <h2
      className={cn(
        'scroll-m-20 text-3xl font-semibold tracking-tight first:mt-0',
        className,
      )}
      {...props}
    />
  )
}

function h3({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'h3'>) {
  return (
    <h3
      className={cn(
        'scroll-m-20 text-2xl font-semibold tracking-tight',
        className,
      )}
      {...props}
    />
  )
}

function h4({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'h4'>) {
  return (
    <h4
      className={cn(
        'scroll-m-20 text-xl font-semibold tracking-tight',
        className,
      )}
      {...props}
    />
  )
}

function p({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'p'>) {
  return <p className={cn('leading-7 not-first:mt-6', className)} {...props} />
}

function blockquote({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'blockquote'>) {
  return (
    <blockquote
      className={cn('mt-6 border-l-2 pl-6 italic', className)}
      {...props}
    />
  )
}

function em({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'em'>) {
  return (
    <em
      className={cn('*:text-m3-secondary/80 text-m3-secondary/80', className)}
      {...props}
    />
  )
}

function ul({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'ul'>) {
  return <ul className={cn('my-2 ml-6 list-disc', className)} {...props} />
}

function ol({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'ol'>) {
  return <ol className={cn('my-2 ml-6 list-decimal', className)} {...props} />
}

function li({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'li'>) {
  return <li className={cn('mt-2', className)} {...props} />
}

function code({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'text-m3-on-surface/80 bg-m3-surface-container-lowest relative rounded border px-2 py-1 font-mono text-sm',
        className,
      )}
      {...props}
    />
  )
}

function inlineCode({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'code'>) {
  return (
    <code
      className={cn(
        'text-m3-on-surface/80 bg-m3-surface-container-lowest relative rounded border px-1 py-0.5 font-mono text-sm',
        className,
      )}
      {...props}
    />
  )
}

function quoted({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('quoted text-m3-primary *:text-m3-primary', className)}
      {...props}
    />
  )
}

function lead({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'p'>) {
  return (
    <p
      className={cn('lead text-muted-foreground text-xl', className)}
      {...props}
    />
  )
}

function large({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'p'>) {
  return (
    <p className={cn('large text-lg font-semibold', className)} {...props} />
  )
}

function medium({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'p'>) {
  return (
    <p className={cn('medium text-md font-medium', className)} {...props} />
  )
}

function small({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'small'>) {
  return (
    <small
      className={cn('small text-sm leading-none font-medium', className)}
      {...props}
    />
  )
}

function muted({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('muted text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

function kbd({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-6 min-w-6 items-center justify-center rounded border px-1.5 font-sans text-xs font-medium',
        className,
      )}
      {...props}
    />
  )
}

function hr({ className, ...props }: React.ComponentProps<'hr'>) {
  return <hr className={cn('my-4', className)} {...props} />
}

function a({
  href,
  newTab = true,
  className,
  ...props
}: {
  href?: string
  newTab?: boolean
} & React.ComponentProps<'a'>) {
  return (
    <a
      href={href}
      target={newTab ? '_blank' : undefined}
      className={cn('text-m3-primary font-medium underline', className)}
      {...props}
    />
  )
}

function table({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'table'>) {
  return (
    <table
      className={cn('my-4 w-full border-collapse border', className)}
      {...props}
    />
  )
}

function thead({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'thead'>) {
  return <thead className={cn('bg-muted/50 border-b', className)} {...props} />
}

function tbody({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'tbody'>) {
  return (
    <tbody
      className={cn('[&_tr:last-child]:border-b-0', className)}
      {...props}
    />
  )
}

function tr({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'hover:bg-m3-surface-container border-b transition-colors',
        className,
      )}
      {...props}
    />
  )
}

function th({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-r px-3 py-2 text-left font-medium last:border-r-0',
        className,
      )}
      {...props}
    />
  )
}

function td({
  className,
  ...props
}: {
  className?: string
} & React.ComponentProps<'td'>) {
  return (
    <td
      className={cn('border-r px-3 py-2 last:border-r-0', className)}
      {...props}
    />
  )
}

export const T = {
  h1,
  h2,
  h3,
  h4,
  p,
  em,
  blockquote,
  ul,
  ol,
  li,
  code,
  inlineCode,
  quoted,
  lead,
  large,
  medium,
  small,
  muted,
  kbd,
  hr,
  a,
  table,
  thead,
  tbody,
  tr,
  th,
  td,
}
