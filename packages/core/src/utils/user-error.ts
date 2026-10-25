import { errorMessage } from './errors'

const MAX_MESSAGE_LENGTH = 320

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.'

const DB_FAILURE_PATTERN =
  /Failed to (?:insert|update).*document in table|does not match the schema|Object contains extra field/i

const ARG_FAILURE_PATTERN =
  /ArgumentValidationError|ReturnsValidationError|Validator: v\./

/** Formats concise UI feedback without exposing database records or validation dumps. */
export function userErrorMessage(error: unknown, fallback = DEFAULT_MESSAGE) {
  const message = errorMessage(error) ?? fallback
  const databaseFailure = DB_FAILURE_PATTERN.test(message)

  if (databaseFailure) {
    return bounded(
      'The application could not save these changes. Please report this problem to the developer.',
    )
  }
  const argumentFailure = ARG_FAILURE_PATTERN.test(message)
  if (argumentFailure) {
    return bounded(
      'The application could not process this request. Please report this problem to the developer.',
    )
  }
  if (error instanceof SyntaxError) {
    return 'The file could not be read. Check that its format and syntax are correct.'
  }
  return bounded(
    validationMessage(error) ?? serializedValidation(message) ?? message,
  )
}

function serializedValidation(message: string): string | undefined {
  if (!message.startsWith('[')) return
  try {
    return validationMessage({ issues: JSON.parse(message) })
  } catch {
    return
  }
}

function validationMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('issues' in error)) return
  if (!Array.isArray(error.issues)) return
  const issue = error.issues[0]
  if (!issue || typeof issue.message !== 'string') return
  const field = Array.isArray(issue.path) ? issue.path.join('.') : ''
  return field ? `${field}: ${issue.message}` : issue.message
}

function bounded(message: string) {
  const text = message.replace(/\s+/g, ' ').trim() || DEFAULT_MESSAGE
  if (text.length <= MAX_MESSAGE_LENGTH) return text
  const preview = text.slice(0, MAX_MESSAGE_LENGTH - 1)
  const space = preview.lastIndexOf(' ')
  return `${preview.slice(0, space > MAX_MESSAGE_LENGTH / 2 ? space : undefined)}…`
}
