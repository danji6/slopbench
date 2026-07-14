import type { Prompt } from '@/lib/chat'
import { useClipboard } from '@/lib/clipboard'
import { z } from 'zod'

// TODO make backward compatible
const promptClipboardSchema = z.object({
  name: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  enabled: z.boolean(),
  visible: z.boolean(),
  starter: z.boolean().default(false),
})

export function usePromptClipboard() {
  const { copy, paste, clear } = useClipboard('prompt')
  const parsed = paste ? promptClipboardSchema.safeParse(paste) : null
  return {
    copy: (prompt: Prompt) => copy(prompt),
    pasteData: parsed?.success ? parsed.data : null,
    clear,
  }
}
