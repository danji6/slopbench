import { cn } from '@/lib/utils'

export function List<T>({
  items,
  render,
  keys,
  className,
  ...props
}: {
  items?: T[]
  render: (item: T, index: number) => React.ReactNode | null
  keys?: (item: T, index: number) => string | number
  className?: string
} & React.ComponentProps<'ul'>) {
  const keyFn = keys || ((_, index) => index)

  return (
    <ul {...props} data-slot="list" className={cn('list-none p-0', className)}>
      {items?.map((item, index) => (
        <li key={keyFn(item, index)} data-slot="item">
          {render(item, index)}
        </li>
      ))}
    </ul>
  )
}
