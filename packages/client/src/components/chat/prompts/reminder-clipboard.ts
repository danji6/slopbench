import type { ReminderPrompt } from '@/lib/chat'
import { useClipboard } from '@/lib/clipboard'
import { z } from 'zod'

const reminderClipboardSchema = z.object({
  name: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  enabled: z.boolean(),
  interval: z.number().int().min(1),
  eager: z.boolean().optional(),
})

export function useReminderClipboard() {
  const { copy, paste, clear } = useClipboard('reminder')
  const parsed = paste ? reminderClipboardSchema.safeParse(paste) : null
  return {
    copy: (reminder: ReminderPrompt) => copy(reminder),
    pasteData: parsed?.success ? parsed.data : null,
    clear,
  }
}
