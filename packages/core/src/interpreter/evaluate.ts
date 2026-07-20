import { SESSION_ENV_NAMES } from './env'
import { parse } from './parse'
import { createVariableStore } from './store'
import type { EvalContext, JsonValue, Segment, VariableStore } from './types'

type CompiledFn = (...args: unknown[]) => unknown

/** Host-provided functions exposed to dynamic blocks (all synchronous). */
export type EvalHelpers = {
  file?: (path: string, wrap?: boolean) => string
}

export function evaluate(
  text: string,
  context: EvalContext = {},
  store: VariableStore = createVariableStore(),
  helpers: EvalHelpers = {},
): string {
  const segments = parse(text)
  if (segments.length === 0) return ''

  const get = (key: string) => store.get(key)
  const set = (key: string, value: JsonValue) => store.set(key, value)
  const bindings = sessionBindings(context, get, set, helpers)
  const args = SESSION_ENV_NAMES.map((name) => bindings[name])

  const parts: string[] = []
  const isEmptyBlock: boolean[] = []

  for (const segment of segments) {
    if (segment.type === 'literal') {
      parts.push(segment.text)
      isEmptyBlock.push(false)
      continue
    }

    const fn = compile(segment)
    let str = ''
    if (fn) {
      try {
        str = stringify(fn(...args))
      } catch (error) {
        console.error('[interpreter] runtime error', error)
      }
    }
    parts.push(str)
    isEmptyBlock.push(segment.type === 'block' && str === '')
  }

  for (let i = 0; i < parts.length; i++) {
    if (!isEmptyBlock[i]) continue
    if (i < parts.length - 1) parts[i + 1] = parts[i + 1].replace(/^\n/, '')
  }

  return parts.join('').trimEnd()
}

function sessionBindings(
  context: EvalContext,
  get: (key: string) => JsonValue | undefined,
  set: (key: string, value: JsonValue) => void,
  helpers: EvalHelpers,
): Record<string, unknown> {
  const agent = context.assistant
  return {
    file: helpers.file ?? (() => ''),
    user: context.user,
    owner: context.owner,
    agent,
    assistant: agent,
    char: agent,
    ai: agent,
    tools: context.tools ?? [],
    isAdmin: context.isAdmin ?? false,
    userCount: context.userCount ?? 0,
    agentCount: context.agentCount ?? 0,
    workDir: context.workDir,
    getVar: get,
    setVar: set,
  }
}

function compile(
  segment: Exclude<Segment, { type: 'literal' }>,
): CompiledFn | null {
  const body =
    segment.type === 'inline' ? `return (${segment.expr})` : segment.code
  try {
    return new Function(...SESSION_ENV_NAMES, body) as CompiledFn
  } catch (error) {
    console.error('[interpreter] compile error', error)
    return null
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    const json = JSON.stringify(value)
    return json ?? ''
  } catch (error) {
    console.error('[interpreter] stringify error', error)
    return ''
  }
}
