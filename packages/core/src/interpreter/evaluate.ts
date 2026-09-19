import { CONSUMED_LINE, formatOutput } from './format'
import { parse } from './parse'
import { createSandbox } from './sandbox'
import { createVariableStore } from './store'
import type { Condition, EvalContext, VariableStore } from './types'

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

  const sandbox = createSandbox(context, store, helpers)
  try {
    return render(text, sandbox.run)
  } finally {
    sandbox.dispose()
  }
}

/** Renders parsed directives using the supplied isolated guest. */
export function render(text: string, run: (body: string) => unknown): string {
  const segments = parse(text)
  const parts: string[] = []
  const stack: BranchFrame[] = []
  const currentActive = () =>
    stack.length === 0 || stack[stack.length - 1].branchActive
  const truthy = (cond: Condition) => Boolean(run(conditionBody(cond)))

  for (const segment of segments) {
    switch (segment.type) {
      case 'if': {
        const parentActive = currentActive()
        const val = parentActive && truthy(segment.cond)
        stack.push({ parentActive, taken: val, branchActive: val })
        parts.push(CONSUMED_LINE)
        continue
      }
      case 'elif': {
        const frame = stack[stack.length - 1]
        if (frame) {
          const val = frame.parentActive && !frame.taken && truthy(segment.cond)
          frame.branchActive = val
          if (val) frame.taken = true
        }
        parts.push(CONSUMED_LINE)
        continue
      }
      case 'else': {
        const frame = stack[stack.length - 1]
        if (frame) {
          frame.branchActive = frame.parentActive && !frame.taken
          frame.taken = true
        }
        parts.push(CONSUMED_LINE)
        continue
      }
      case 'endif': {
        stack.pop()
        parts.push(CONSUMED_LINE)
        continue
      }
      case 'literal': {
        parts.push(currentActive() ? segment.text : '')
        continue
      }
      default: {
        if (!currentActive()) {
          parts.push('')
          continue
        }
        const body =
          segment.type === 'inline' ? `return (${segment.expr})` : segment.code
        const str = stringify(run(body))
        // An eval block that renders nothing takes its own line with it
        const empty = segment.type === 'block' && str === ''
        parts.push(empty ? CONSUMED_LINE : str)
      }
    }
  }

  return formatOutput(parts.join(''))
}

type BranchFrame = {
  parentActive: boolean
  taken: boolean
  branchActive: boolean
}

const conditionBody = (cond: Condition) =>
  cond.kind === 'expr' ? `return (${cond.expr})` : cond.code

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
