'use node'

import { ConvexError } from 'convex/values'

import { error, extractErrorMessage } from '../../errors'
import { postSidecar } from '../sidecar'

/** Bounds integration filesystem requests independently of toolkit operation deadlines. */
export async function integrationRequest<T>(route: string, body: unknown) {
  try {
    return await postSidecar<T>(
      `/integrations/${route}`,
      body,
      AbortSignal.timeout(30_000),
    )
  } catch (cause) {
    if (cause instanceof ConvexError) throw cause
    if (cause instanceof Error && cause.name === 'TimeoutError')
      error('Integration request timed out', 504)
    error(`Integration request failed: ${extractErrorMessage(cause)}`, 502)
  }
}
