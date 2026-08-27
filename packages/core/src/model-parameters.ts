import { MAX_MODEL_EXTRA_PARAMETERS_CHARS } from './limits'

export const RESERVED_MODEL_PARAMETER_KEYS = new Set([
  'model',
  'messages',
  'input',
  'system',
  'tools',
  'tool_choice',
  'stream',
])

export function parseModelExtraParameters(
  source: string | undefined,
): Record<string, unknown> {
  const value = source?.trim()
  if (!value) return {}
  if (value.length > MAX_MODEL_EXTRA_PARAMETERS_CHARS) {
    throw new Error(
      `Extra parameters must be at most ${MAX_MODEL_EXTRA_PARAMETERS_CHARS} characters.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Extra parameters must be valid JSON.')
  }

  if (!isPlainObject(parsed)) {
    throw new Error('Extra parameters must be a JSON object.')
  }

  const reserved = Object.keys(parsed).filter((key) =>
    RESERVED_MODEL_PARAMETER_KEYS.has(key),
  )
  if (reserved.length > 0) {
    throw new Error(
      `Extra parameters cannot replace reserved fields: ${reserved.join(', ')}.`,
    )
  }

  return parsed
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
