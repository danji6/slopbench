import { errorMessage, errorMessageChain } from '@sb/core/utils/errors'
import { ConvexError } from 'convex/values'

export type ErrorPayload = { message: string; code: number }

export function error(message: string, code = 400): never {
  throw new ConvexError({
    message,
    code,
  } satisfies ErrorPayload)
}

export function extractError(obj: unknown): ConvexError<ErrorPayload> {
  return new ConvexError({
    message: extractErrorMessage(obj),
    code: 500,
  } satisfies ErrorPayload)
}

export function extractErrorMessage(err: unknown): string {
  return errorMessage(err) ?? String(err)
}

/**
 * A user-facing tool failure. Throwing this from a tool's `execute` yields an
 * explicit `output-error` part whose `errorText` is this message.
 */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** Throws a {@link ToolError}, preserving an already typed one. */
export function toolFailure(error: unknown): never {
  throw error instanceof ToolError
    ? error
    : new ToolError(extractErrorMessage(error))
}

export function sanitizeChatError(error: unknown): string {
  if (error instanceof ConvexError) {
    return errorMessage(error) ?? JSON.stringify(error)
  }

  return errorMessageChain(error) ?? JSON.stringify(error)
}
