import { environmentCapError } from '@sb/core/interpreter/store'
import {
  MAX_CUSTOM_CSS_CHARS,
  MAX_MESSAGE_PART_BYTES,
  MAX_PLAN_CONTENT_CHARS,
  MAX_SEGMENT_BYTES,
  MAX_TODO_CONTENT_CHARS,
  MAX_TODO_ITEMS,
} from '@sb/core/limits'
import { serializedSize } from '@sb/core/utils/size'

import { error } from '../errors'
import type { TodoItem } from '../types'

export function assertCustomCssCap(css: string | undefined) {
  if (css && css.length > MAX_CUSTOM_CSS_CHARS) {
    error(`Custom CSS exceeds ${MAX_CUSTOM_CSS_CHARS} characters`, 400)
  }
}

export function assertEnvironmentCap(environment: Record<string, unknown>) {
  const capError = environmentCapError(environment)
  if (capError) error(capError, 400)
}

export function assertTodoItemsCap(items: TodoItem[]) {
  if (items.length > MAX_TODO_ITEMS) {
    error(`At most ${MAX_TODO_ITEMS} todos`, 400)
  }
  if (items.some((item) => item.content.length > MAX_TODO_CONTENT_CHARS)) {
    error(`A todo exceeds ${MAX_TODO_CONTENT_CHARS} characters`, 400)
  }
}

export function planContentCapError(content: string): string | null {
  return content.length > MAX_PLAN_CONTENT_CHARS
    ? `The plan exceeds ${MAX_PLAN_CONTENT_CHARS} characters. Shorten it.`
    : null
}

export function assertPlanContentCap(content: string) {
  const capError = planContentCapError(content)
  if (capError) error(capError, 400)
}

export function assertPartsCap(parts: unknown[]) {
  if (parts.some((part) => serializedSize(part) > MAX_MESSAGE_PART_BYTES)) {
    error(`A message part exceeds ${MAX_MESSAGE_PART_BYTES} bytes`, 400)
  }
}

export function assertSegmentFits(parts: unknown[]) {
  assertPartsCap(parts)
  if (serializedSize(parts) > MAX_SEGMENT_BYTES) {
    error(`Message content exceeds ${MAX_SEGMENT_BYTES} bytes`, 400)
  }
}
