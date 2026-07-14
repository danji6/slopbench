export class ServerError extends Error {
  public message: string
  public error = true
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.message = message
    this.error = true
    this.status = status
  }

  static from(error: unknown) {
    if (error instanceof ServerError) {
      return error
    }
    return new ServerError(extractErrorMessage(error), 500)
  }
}

export class PayloadTooLargeError extends Error {
  readonly maxSize: number

  constructor(maxSize: number) {
    super(`Payload too large (max ${maxSize} bytes)`)
    this.name = 'PayloadTooLargeError'
    this.maxSize = maxSize
  }
}

export function serverError(
  message = 'Internal server error',
  status = 500,
): never {
  throw new ServerError(message, status)
}

export function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return extractionError(error)
  }

  const data = getProperty(error, 'data')
  const message =
    getProperty(data, 'message') ??
    (typeof data === 'string' ? data : undefined) ??
    getProperty(error, 'message') ??
    getProperty(error, 'statusText')

  if (typeof message !== 'string') {
    return extractionError(error)
  }

  return message
}

function getProperty(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' && key in obj
    ? (obj as Record<string, unknown>)[key]
    : undefined
}

function extractionError(error: unknown) {
  console.error(error)
  return 'Error message could not be extracted, please report this to the developer'
}
