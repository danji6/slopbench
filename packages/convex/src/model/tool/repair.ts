import type { LanguageModelV3ToolCall } from '@ai-sdk/provider'

type JsonObject = Record<string, unknown>

/**
 * Attempts to fix common shape mistakes models make when calling
 * `edit_file`/`write_file`/`edit_plan`.
 *
 * @returns null when the call can't be confidently repaired
 */
export function repairToolCall(
  toolCall: LanguageModelV3ToolCall,
): LanguageModelV3ToolCall | null {
  switch (toolCall.toolName) {
    case 'edit_file':
      return repairEditFileCall(toolCall)
    case 'write_file':
      return repairWriteFileCall(toolCall)
    case 'edit_plan':
      return repairEditPlanCall(toolCall)
    default:
      return null
  }
}

function parseObject(input: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(input)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonObject)
      : null
  } catch {
    return null
  }
}

/**
 * The canonical field is `path`, but models (especially ones whose native
 * tools use `file_path`) routinely send an alias instead. Recover it.
 */
const PATH_ALIASES = ['path', 'file_path', 'filePath', 'filepath'] as const

function resolvePath(obj: JsonObject): string | null {
  for (const key of PATH_ALIASES) {
    if (typeof obj[key] === 'string') return obj[key] as string
  }
  return null
}

function repairEditFileCall(
  toolCall: LanguageModelV3ToolCall,
): LanguageModelV3ToolCall | null {
  const obj = parseObject(toolCall.input)
  if (!obj) return null

  const path = resolvePath(obj)
  if (path === null) return null

  const edits = normalizeEdits(obj)
  if (edits) {
    return { ...toolCall, input: JSON.stringify({ path, edits }) }
  }

  // Redirect to `write_file` if `content` is a plain string
  if (typeof obj.content === 'string') {
    return {
      ...toolCall,
      toolName: 'write_file',
      input: JSON.stringify({ path, content: obj.content }),
    }
  }

  return null
}

function repairWriteFileCall(
  toolCall: LanguageModelV3ToolCall,
): LanguageModelV3ToolCall | null {
  const obj = parseObject(toolCall.input)
  if (!obj || typeof obj.content !== 'string') return null

  const path = resolvePath(obj)
  if (path === null) return null

  return {
    ...toolCall,
    input: JSON.stringify({ path, content: obj.content }),
  }
}

function repairEditPlanCall(
  toolCall: LanguageModelV3ToolCall,
): LanguageModelV3ToolCall | null {
  const obj = parseObject(toolCall.input)
  if (!obj) return null

  const edits = normalizeEdits(obj)
  if (edits) return { ...toolCall, input: JSON.stringify({ edits }) }

  // Redirect to `write_plan` if `content` is a plain string
  if (typeof obj.content === 'string') {
    return {
      ...toolCall,
      toolName: 'write_plan',
      input: JSON.stringify({ content: obj.content }),
    }
  }

  return null
}

/**
 * Recovers `edits` from shapes models mistakenly send instead of
 * `edits: [{ oldText, newText }]`:
 * - a flat `{ oldText, newText }` pair with no `edits` array at all
 * - an `edits` array whose single entry is missing `oldText`/`newText` that
 *   were instead left dangling as top-level fields
 */
function normalizeEdits(
  obj: JsonObject,
): Array<{ oldText: string; newText: string }> | null {
  const strayOldText = typeof obj.oldText === 'string' ? obj.oldText : undefined
  const strayNewText = typeof obj.newText === 'string' ? obj.newText : undefined

  if (!Array.isArray(obj.edits)) {
    if (strayOldText === undefined || strayNewText === undefined) return null
    return [{ oldText: strayOldText, newText: strayNewText }]
  }

  if (obj.edits.length === 0) return null

  const entries = flattenEditEntries(obj.edits)
  if (entries.length === 0) return null

  const edits = entries.map((entry) => {
    const e = entry && typeof entry === 'object' ? (entry as JsonObject) : {}
    return {
      oldText: typeof e.oldText === 'string' ? e.oldText : strayOldText,
      newText: typeof e.newText === 'string' ? e.newText : strayNewText,
    }
  })

  const complete = edits.filter(
    (e): e is { oldText: string; newText: string } =>
      typeof e.oldText === 'string' && typeof e.newText === 'string',
  )
  return complete.length === edits.length ? complete : null
}

/** Flattens one level of accidental nesting, e.g. `edits: [[{...}], [{...}]]`. */
function flattenEditEntries(edits: unknown[]): unknown[] {
  const flat: unknown[] = []
  for (const entry of edits) {
    if (Array.isArray(entry)) {
      flat.push(...entry)
    } else {
      flat.push(entry)
    }
  }
  return flat
}
