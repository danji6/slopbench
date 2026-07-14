
import { createOptionalContext } from '@/hooks/context'

export type MessageContextValue = {
  id: string
  canEdit: boolean
  content: string
}

export const [MessageContext, useMessage] =
  createOptionalContext<MessageContextValue>()
