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
  return err instanceof Error ? err.message : String(err)
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
  let message: string

  if (error instanceof ConvexError) {
    const data = error.data as ErrorPayload | undefined
    message = data?.message ?? JSON.stringify(error)
  } else if (error instanceof Error) {
    message = getErrorMessageChain(error)
  } else if (typeof error === 'string') {
    message = error
  } else {
    return JSON.stringify(error)
  }

  return message
}

function getErrorMessageChain(error: unknown): string {
  const messages: string[] = []
  let current: unknown = error

  while (current instanceof Error) {
    messages.push(current.message)
    current = (current as Error & { cause?: unknown }).cause
  }

  return messages.join(' ')
}
