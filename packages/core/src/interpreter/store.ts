import { MAX_ENVIRONMENT_BYTES, MAX_ENVIRONMENT_KEYS } from '../limits'
import { serializedSize } from '../utils/size'
import type { JsonValue, VariableStore } from './types'

/** Why this environment is over its caps, or null when it fits. */
export function environmentCapError(
  environment: Record<string, unknown>,
): string | null {
  if (Object.keys(environment).length > MAX_ENVIRONMENT_KEYS) {
    return `Sesssion variables limit exceeded (max: ${MAX_ENVIRONMENT_KEYS})`
  }
  if (serializedSize(environment) > MAX_ENVIRONMENT_BYTES) {
    return `Session variables size limit exceeded (max: ${MAX_ENVIRONMENT_BYTES} bytes)`
  }
  return null
}

export function createVariableStore(
  initial: Record<string, JsonValue> = {},
): VariableStore {
  const data: Record<string, JsonValue> = { ...initial }
  let dirty = false

  return {
    get(key) {
      return data[key]
    },
    set(key, value) {
      const previous = data[key]
      const had = key in data
      data[key] = value

      // The evaluator catches this, so the expression yields nothing and the
      // rest of the message still renders
      const capError = environmentCapError(data)
      if (capError) {
        if (had) data[key] = previous
        else delete data[key]
        throw new Error(capError)
      }

      dirty = true
    },
    toRecord() {
      return { ...data }
    },
    isDirty() {
      return dirty
    },
    markClean() {
      dirty = false
    },
  }
}
