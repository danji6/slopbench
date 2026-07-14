import { Code, T } from '@/components/ui'
import { cn } from '@/lib'
import type { MarkdownComponents } from '@/lib/markdown/remark'

import { MarkdownAnchor } from './anchor'
import { MarkdownListItem } from './list-item'
import { KatexMath, matchMathClass } from './math'

const defaultVariant: MarkdownComponents = {
  h1: T.h1,
  h2: DefaultH2Anchor,
  h3: T.h3,
  h4: T.h4,
  em: T.em,
  'md-quoted': T.quoted,
  'md-mention': MarkdownMention,
  p: T.p,
  blockquote: T.blockquote,
  ul: T.ul,
  ol: T.ol,
  li: MarkdownListItem,
  hr: T.hr,
  table: T.table,
  thead: T.thead,
  tbody: T.tbody,
  tr: T.tr,
  th: T.th,
  td: T.td,
  a: DefaultAnchor,
  code: DefaultCodeBlock,
}

const slimVariant: MarkdownComponents = {
  ...defaultVariant,
  h1: (props) => <T.h1 className="text-2xl" {...props} />,
  h2: (props) => <T.h2 className="pb-0 text-xl" {...props} />,
  h3: (props) => <T.h3 className="text-lg" {...props} />,
  h4: (props) => <T.h4 className="text-md" {...props} />,
  ul: (props) => <ul className="m-0 ml-6 list-disc" {...props} />,
  li: SlimListItem,
  code: SlimCodeBlock,
  p: (props) => <p className="m-0" {...props} />,
}

function MarkdownMention({
  path,
  children,
}: {
  path?: string
  children?: React.ReactNode
}) {
  return (
    <span className="mention text-m3-primary font-medium" title={path}>
      {children}
    </span>
  )
}

function DefaultAnchor({ href, ...props }: React.ComponentProps<'a'>) {
  return href?.startsWith('#') ? (
    <MarkdownAnchor href={href} {...props} />
  ) : (
    <T.a href={href} {...props} />
  )
}

function DefaultH2Anchor({ id, ...props }: React.ComponentProps<'h2'>) {
  return (
    <span className="mt-6 flex items-center justify-between gap-2 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0">
      <h2 {...props} id={id} className="grow scroll-m-20" />
    </span>
  )
}

function H2AnchorHash({ id, ...props }: React.ComponentProps<'h2'>) {
  return (
    <DefaultH2Anchor id={id} {...props}>
      <MarkdownAnchor
        href={`#${id}`}
        className="text-2xl no-underline opacity-50 transition-opacity hover:opacity-100"
      >
        #
      </MarkdownAnchor>
    </DefaultH2Anchor>
  )
}

function DefaultCodeBlock({
  className,
  children,
}: React.ComponentProps<'code'>) {
  const display = matchMathClass(className)
  if (display !== null) {
    return <KatexMath latex={String(children)} display={display} />
  }
  const match = /language-(\w+)/.exec(className ?? '')
  if (match) {
    return (
      <Code
        text={String(children).trimEnd()}
        language={match[1]}
        hugParent
        className="mt-4"
        noLoadingIndicator
        lineNumbers
      />
    )
  }
  return <T.inlineCode>{children}</T.inlineCode>
}

function SlimCodeBlock({ children, ...props }: React.ComponentProps<'code'>) {
  const display = matchMathClass(props.className)
  if (display !== null) {
    return <KatexMath latex={String(children)} display={display} />
  }
  return (
    <T.code className="px-1 py-0" {...props}>
      {children}
    </T.code>
  )
}

function SlimListItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <MarkdownListItem
      className={cn('m-0 mt-0.5', className)}
      paragraphClassName="m-0"
      {...props}
    />
  )
}

export const MarkdownVariants = {
  default: defaultVariant,
  slim: slimVariant,
}

export { H2AnchorHash }
