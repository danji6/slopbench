import { toast } from 'sonner'

import { extractErrorMessage } from './errors'

export { toast }

export function toastError(error: unknown, fallback?: string) {
  console.error(error)
  toast.error(extractErrorMessage(error, fallback))
}
