import { getSidecar } from './sidecar'

export type UpdateStatus = {
  current: string
  latest?: string
  notes?: string
  publishedAt?: string
  url?: string
  available: boolean
  reason?: string
}

/** Asks the host what version it is running and whether a newer release exists. */
export function readUpdateStatus(): Promise<UpdateStatus> {
  return getSidecar<UpdateStatus>('/update/status')
}
