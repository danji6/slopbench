import { cn } from '@/lib/utils'

import { Code, type CodeProps } from '../ui'

export function MarkdownCode({ innerClassName, ...props }: CodeProps) {
  return (
    <Code
      delay={500}
      noLoadingIndicator
      lineNumbers
      innerClassName={cn('max-h-120 border-0', innerClassName)}
      hugParent
      {...props}
    />
  )
}
