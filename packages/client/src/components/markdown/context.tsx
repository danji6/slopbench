
import { createUsableContext } from '@/hooks'

export type MarkdownContextProps = {
  mdKey?: string // key for caching
  isViewer?: boolean // disables editing features if true
  setThemeColor?: (color?: string) => void
  setBanner?: (banner?: string | Blob) => void
}

export const [MarkdownContext, useMarkdown] =
  createUsableContext<MarkdownContextProps>('Markdown')
