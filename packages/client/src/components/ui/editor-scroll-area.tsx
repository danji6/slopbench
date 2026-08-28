import { cn } from '@/lib/utils'
import { EditorContent } from '@tiptap/react'
import type { ComponentProps } from 'react'

export type EditorScrollAreaProps = ComponentProps<typeof EditorContent>

/** Bounded TipTap content that scrolls within its editor surface. */
export function EditorScrollArea({
  className,
  ...props
}: EditorScrollAreaProps) {
  return (
    <EditorContent
      className={cn('min-h-0 flex-1 overflow-auto', className)}
      {...props}
    />
  )
}
