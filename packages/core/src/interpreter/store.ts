import type { JsonValue, VariableStore } from './types'

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
      data[key] = value
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
