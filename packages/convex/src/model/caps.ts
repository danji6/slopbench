import { environmentCapError } from '@sb/core/interpreter/store'
import { limitError } from '@sb/core/limit-errors'
import {
  MAX_CUSTOM_CSS_CHARS,
  MAX_MESSAGE_PART_BYTES,
  MAX_PLAN_CONTENT_CHARS,
  MAX_SEGMENT_BYTES,
  MAX_TODO_CONTENT_CHARS,
  MAX_TODO_ITEMS,
  MAX_WEB_SEARCH_INSTANCES,
} from '@sb/core/limits'
import { serializedSize } from '@sb/core/utils/size'

import { error } from '../errors'
import type { TodoItem } from '../types'

export function assertCustomCssCap(css: string | undefined) {
  if (css && css.length > MAX_CUSTOM_CSS_CHARS) {
    error(limitError('customCss'), 400)
  }
}

export function assertWebSearchInstancesCap(instances: unknown[] | undefined) {
  if (instances && instances.length > MAX_WEB_SEARCH_INSTANCES) {
    error(limitError('webSearchInstances'), 400)
  }
}

export function assertEnvironmentCap(environment: Record<string, unknown>) {
  const capError = environmentCapError(environment)
  if (capError) error(capError, 400)
}

export function assertTodoItemsCap(items: TodoItem[]) {
  if (items.length > MAX_TODO_ITEMS) {
    error(limitError('todos'), 400)
  }
  if (items.some((item) => item.content.length > MAX_TODO_CONTENT_CHARS)) {
    error(limitError('todoContent'), 400)
  }
}

export function planContentCapError(content: string): string | null {
  return content.length > MAX_PLAN_CONTENT_CHARS
    ? limitError('planContent')
    : null
}

export function assertPlanContentCap(content: string) {
  const capError = planContentCapError(content)
  if (capError) error(capError, 400)
}

export function assertPartsCap(parts: unknown[]) {
  if (parts.some((part) => serializedSize(part) > MAX_MESSAGE_PART_BYTES)) {
    error(limitError('messagePart'), 400)
  }
}

export function assertSegmentFits(parts: unknown[]) {
  assertPartsCap(parts)
  if (serializedSize(parts) > MAX_SEGMENT_BYTES) {
    error(limitError('messageContent'), 400)
  }
}
