import { highlight } from '@/lib/shiki/highlighter'

import { CodeContainer, type CodeProps } from './code'

export async function CodeStatic({
  text,
  language = 'typescript',
  ...props
}: CodeProps) {
  if (!text) return null
  return (
    <CodeContainer
      // biome-ignore lint/security/noDangerouslySetInnerHtml: needed for Shiki to work
      dangerouslySetInnerHTML={{ __html: await highlight(text, language) }}
      copyValue={text}
      lineNumberValue={text}
      {...props}
    />
  )
}
