import type { MathMode } from '@/lib/chat'
import { normalizeMathDelimiters } from '@/lib/markdown/helpers'
import {
  type MarkdownComponents,
  remarkCodeMeta,
  remarkGroup,
  remarkHighlightQuotes,
  remarkMention,
  remarkMeta,
  remarkPromoteDisplayMath,
  remarkSplitImages,
} from '@/lib/markdown/remark'
import { cn } from '@/lib/utils'
import { dedent } from '@sb/core/utils/strings'
import type React from 'react'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkToc from 'remark-toc'

import { Surface } from '../ui'
import { MarkdownGroup } from './group'
import { MarkdownMeta } from './meta'
import { H2AnchorHash, MarkdownVariants } from './variants'

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'md-group',
    'md-meta',
    'md-quoted',
    'md-mention',
    'md-streaming-cursor',
  ],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    code: [
      [
        'className',
        /^language-./,
        // Prevent math classes from getting stripped
        'math-inline',
        'math-display',
      ],
      'data*',
    ],
    'md-group': ['type', 'items', 'direction'],
    'md-meta': ['content'],
    'md-mention': ['path'],
  },
}

type MarkdownProps = Parameters<typeof Markdown>[0]
type RemarkPlugin = NonNullable<MarkdownProps['remarkPlugins']>[number]

export type MarkdownRendererProps = MarkdownProps & {
  components?: MarkdownComponents
  enableBreaks?: boolean
  enableGroups?: boolean // enable code/media grouping
  enableMeta?: boolean // enable metadata parsing like theme color extraction
  mathMode?: MathMode
  enableAnchorHashes?: boolean
  remarkPlugins?: MarkdownProps['remarkPlugins']
  rehypePlugins?: MarkdownProps['rehypePlugins']
}

export type MarkdownSurfaceProps = Omit<MarkdownRendererProps, 'children'> &
  Pick<
    React.ComponentProps<typeof Surface>,
    'ref' | 'children' | 'className'
  > & {
    content?: string
  }

export function MarkdownRenderer({
  components = {},
  enableBreaks,
  enableGroups,
  enableMeta,
  mathMode,
  enableAnchorHashes,
  remarkPlugins: extraRemarkPlugins = [],
  rehypePlugins: extraRehypePlugins = [],
  children,
  ...props
}: MarkdownRendererProps) {
  const mathEnabled = !!mathMode && mathMode !== 'off'
  const content =
    mathEnabled && typeof children === 'string'
      ? normalizeMathDelimiters(children)
      : children
  const mathPlugin: RemarkPlugin =
    mathMode === 'double'
      ? [remarkMath, { singleDollarTextMath: false }]
      : remarkMath
  const remarkPlugins = [
    remarkToc,
    remarkSplitImages,
    remarkCodeMeta,
    remarkMention, // order matters
    remarkHighlightQuotes,
    ...(mathEnabled ? [mathPlugin, remarkPromoteDisplayMath] : []),
    ...(enableBreaks ? [remarkBreaks] : []),
    remarkGfm,
  ]

  const defaultComponents = Object.assign({}, MarkdownVariants.default)

  if (enableGroups) {
    remarkPlugins.push(remarkGroup)
    defaultComponents['md-group'] = MarkdownGroup
  }

  if (enableMeta) {
    remarkPlugins.push(remarkMeta)
    defaultComponents['md-meta'] = MarkdownMeta
  }

  if (enableAnchorHashes) {
    defaultComponents.h2 = (props) => <H2AnchorHash {...props} />
  }

  // Extra plugins appended last so they see the fully-processed AST
  remarkPlugins.push(...(extraRemarkPlugins as typeof remarkPlugins))

  return (
    <Markdown
      components={{
        ...defaultComponents,
        ...components,
      }}
      remarkPlugins={remarkPlugins}
      rehypePlugins={[
        rehypeRaw,
        [rehypeSanitize, sanitizeSchema],
        rehypeSlug,
        ...(extraRehypePlugins as []),
      ]}
      {...props}
    >
      {content}
    </Markdown>
  )
}

export function MarkdownSurface({
  content,
  children,
  className,
  ...props
}: MarkdownSurfaceProps) {
  return (
    <Surface className={cn('size-full p-5 wrap-anywhere', className)}>
      {children}
      <MarkdownRenderer {...props}>{content}</MarkdownRenderer>
    </Surface>
  )
}

export function MarkdownSnippet(props: MarkdownRendererProps) {
  return <MarkdownRenderer components={MarkdownVariants.slim} {...props} />
}

export function md(
  strings: TemplateStringsArray,
  ...values: unknown[]
): React.ReactElement {
  return <MarkdownSnippet>{dedent(strings, ...values)}</MarkdownSnippet>
}
