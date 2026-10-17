import { errorMessage } from '@sb/core/utils/errors'
import type { Context } from 'hono'
import { ZodError } from 'zod'

import { EvaluationBusyError } from './eval/pool'

export function sidecarError(err: Error, c: Context) {
  // Keep provider diagnostics out of I/O logs, which may contain callback data.
  if (c.req.path.startsWith('/providers/chatgpt/')) {
    return c.json(
      {
        error:
          err instanceof ZodError ? 'Invalid provider request' : err.message,
      },
      400,
    )
  }
  if (c.req.path.startsWith('/eval/')) {
    if (err instanceof ZodError)
      return c.json({ error: 'Invalid evaluation request' }, 400)
    if (err instanceof EvaluationBusyError)
      return c.json({ error: err.message }, 503)
    return c.json(
      { error: 'Dynamic JavaScript failed or exceeded its resource limit' },
      422,
    )
  }
  if (c.req.path.startsWith('/agent-files/'))
    return c.json(
      { error: requestErrorMessage(err) },
      err instanceof ZodError ? 400 : 409,
    )
  return ioError(c, err)
}

export function ioError(c: Context, err: unknown) {
  const status = err instanceof ZodError ? 400 : 500
  console.error('Error handling I/O request:', err)
  return c.json({ error: requestErrorMessage(err) }, status)
}

/** Returns a readable error. */
function requestErrorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((issue) =>
        issue.path.length
          ? `${issue.path.join('.')}: ${issue.message}`
          : issue.message,
      )
      .join('; ')
  }

  return errorMessage(err) ?? String(err)
}
