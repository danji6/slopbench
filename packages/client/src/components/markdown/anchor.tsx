
import { scrollToId } from '@/lib/utils'

import { T } from '../ui'

export function MarkdownAnchor({
  href,
  ...props
}: {
  href: string
} & React.HTMLAttributes<HTMLAnchorElement>) {
  return (
    <T.a
      href={href}
      {...props}
      onClick={(e) => {
        e.preventDefault()
        const id = decodeURIComponent(href.slice(1))
        if (id) scrollToId(id, true)
        props.onClick?.(e)
      }}
    />
  )
}
