import type { api } from '@cv/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import { useState } from 'react'

type RequestLogSnapshot = FunctionReturnType<typeof api.sessions.getLogUrls>

/** Freezes the URL and diagnostics together for one opening of the request log. */
export function useRequestLogSnapshot(
  value: RequestLogSnapshot | undefined,
  open: boolean,
) {
  const [latched, setLatched] = useState<{ value: RequestLogSnapshot } | null>(
    null,
  )
  if (!open && latched) setLatched(null)
  if (open && !latched && value !== undefined) setLatched({ value })
  return open ? (latched?.value ?? value) : undefined
}
