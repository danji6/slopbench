import { SESSION_ENV_NAMES } from './env'
import { parse } from './parse'
import { createVariableStore } from './store'
import type { Condition, EvalContext, JsonValue, VariableStore } from './types'

type CompiledFn = (...args: unknown[]) => unknown

/** Host-provided functions exposed to dynamic blocks (all synchronous). */
export type EvalHelpers = {
  readFile?: (path: string, wrap?: boolean) => string
  fileExists?: (path: string) => boolean
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

  const stack: BranchFrame[] = []
  const currentActive = () =>
    stack.length === 0 || stack[stack.length - 1].branchActive
  const truthy = (cond: Condition) => Boolean(run(conditionBody(cond), args))

  for (const segment of segments) {
    switch (segment.type) {
      case 'if': {
        const parentActive = currentActive()
        const val = parentActive && truthy(segment.cond)
        stack.push({ parentActive, taken: val, branchActive: val })
        parts.push('')
        isEmptyBlock.push(true)
        continue
      }
      case 'elif': {
        const frame = stack[stack.length - 1]
        if (frame) {
          const val = frame.parentActive && !frame.taken && truthy(segment.cond)
          frame.branchActive = val
          if (val) frame.taken = true
        }
        parts.push('')
        isEmptyBlock.push(true)
        continue
      }
      case 'else': {
        const frame = stack[stack.length - 1]
        if (frame) {
          frame.branchActive = frame.parentActive && !frame.taken
          frame.taken = true
        }
        parts.push('')
        isEmptyBlock.push(true)
        continue
      }
      case 'endif': {
        stack.pop()
        parts.push('')
        isEmptyBlock.push(true)
        continue
      }
      case 'literal': {
        parts.push(currentActive() ? segment.text : '')
        isEmptyBlock.push(false)
        continue
      }
      default: {
        if (!currentActive()) {
          parts.push('')
          isEmptyBlock.push(false)
          continue
        }
        const body =
          segment.type === 'inline' ? `return (${segment.expr})` : segment.code
        const str = stringify(run(body, args))
        parts.push(str)
        isEmptyBlock.push(segment.type === 'block' && str === '')
      }
    }
  }

  for (let i = 0; i < parts.length; i++) {
    if (!isEmptyBlock[i]) continue
    if (i < parts.length - 1) parts[i + 1] = parts[i + 1].replace(/^\n/, '')
  }

  return parts.join('').trimEnd()
}

type BranchFrame = {
  parentActive: boolean
  taken: boolean
  branchActive: boolean
}

const conditionBody = (cond: Condition) =>
  cond.kind === 'expr' ? `return (${cond.expr})` : cond.code

/** Compile and run a body with the session args; any error yields undefined. */
function run(body: string, args: unknown[]): unknown {
  const fn = compile(body)
  if (!fn) return undefined
  try {
    return fn(...args)
  } catch (error) {
    console.error('[interpreter] runtime error', error)
    return undefined
  }
}

function sessionBindings(
  context: EvalContext,
  get: (key: string) => JsonValue | undefined,
  set: (key: string, value: JsonValue) => void,
  helpers: EvalHelpers,
): Record<string, unknown> {
  const agent = context.assistant
  return {
    readFile: helpers.readFile ?? (() => ''),
    fileExists: helpers.fileExists ?? (() => false),
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

function compile(body: string): CompiledFn | null {
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
