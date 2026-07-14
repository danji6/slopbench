import { cn } from '@/lib/utils'
import { Children, isValidElement } from 'react'

type MarkdownListItemProps = React.ComponentProps<'li'> & {
  paragraphClassName?: string
}

const blockElements = new Set([
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ol',
  'p',
  'pre',
  'table',
  'ul',
])

export function MarkdownListItem({
  className,
  paragraphClassName,
  children,
  ...props
}: MarkdownListItemProps) {
  return (
    <li className={cn('mt-2', className)} {...props}>
      <ListItemChildren paragraphClassName={paragraphClassName}>
        {children}
      </ListItemChildren>
    </li>
  )
}

function ListItemChildren({
  paragraphClassName,
  children,
}: Pick<MarkdownListItemProps, 'paragraphClassName' | 'children'>) {
  const nodes = Children.toArray(children)
  const result: React.ReactNode[] = []
  let inline: React.ReactNode[] = []

  function flushInline() {
    if (inline.length === 0) return
    result.push(
      <p
        key={`inline-${result.length}`}
        className={cn('my-0 leading-normal', paragraphClassName)}
      >
        {inline}
      </p>,
    )
    inline = []
  }

  nodes.forEach((node) => {
    if (isWhitespace(node)) return
    if (isBlockElement(node)) {
      flushInline()
      result.push(node)
      return
    }
    inline.push(node)
  })

  flushInline()
  return result
}

function isWhitespace(node: React.ReactNode) {
  return typeof node === 'string' && node.trim() === ''
}

function isBlockElement(node: React.ReactNode) {
  if (!isValidElement(node)) return false
  const props = node.props as { node?: { tagName?: string } }
  const tagName =
    typeof node.type === 'string' ? node.type : props.node?.tagName
  return tagName !== undefined && blockElements.has(tagName)
}
