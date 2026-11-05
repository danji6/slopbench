'use node'

import { ConvexError } from 'convex/values'

import { error, extractErrorMessage } from '../../errors'
import { postSidecar } from '../sidecar'

/** Bounds toolkit filesystem requests independently of toolkit operation deadlines. */
export async function toolkitRequest<T>(route: string, body: unknown) {
  try {
    return await postSidecar<T>(
      `/toolkits/${route}`,
      body,
      AbortSignal.timeout(30_000),
    )
  } catch (cause) {
    if (cause instanceof ConvexError) throw cause
    if (cause instanceof Error && cause.name === 'TimeoutError')
      error('Toolkit request timed out', 504)
    error(`Toolkit request failed: ${extractErrorMessage(cause)}`, 502)
  }
}
