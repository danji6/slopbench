import { cn } from '@/lib/utils'

import { Code, type CodeProps } from '../ui/code'
import { useCodeAppearance } from './code-appearance'

export function MarkdownCode({ innerClassName, ...props }: CodeProps) {
  const appearance = useCodeAppearance()
  return (
    <Code
      delay={500}
      noLoadingIndicator
      lineNumbers={appearance.lineNumbers}
      highlighting={appearance.highlighting}
      innerClassName={cn('max-h-120 border-0', innerClassName)}
      hugParent
      {...props}
    />
  )
}
