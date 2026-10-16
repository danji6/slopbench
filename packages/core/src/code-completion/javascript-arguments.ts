import { callContext } from './javascript-context'
import {
  type ArgumentTarget,
  argumentTarget,
  propertyCompletions,
} from './javascript-objects'
import type { JavaScriptSyntax } from './javascript-syntax'
import { argumentValues } from './javascript-values'
import type {
  Completion,
  CompletionItem,
  CompletionRequest,
  SignatureHelp,
} from './types'

type ConfiguredArgument = { signature?: SignatureHelp; target?: ArgumentTarget }

/** Resolves a configured helper and the argument or nested field at the caret. */
export function configuredArgument(
  request: CompletionRequest,
  syntax: JavaScriptSyntax,
  symbols: readonly Completion[],
  locals: Map<string, Completion>,
): ConfiguredArgument {
  const call = callContext(syntax, request.offset)
  if (!call || locals.has(call.name)) return {}

  const helper = symbols.find(
    (symbol) => symbol.label === call.name && symbol.params,
  )
  if (!helper?.params) return {}

  const parameter = helper.params[call.argument]
  const target = parameter
    ? argumentTarget(syntax, request, call.range, parameter)
    : undefined

  return {
    target,
    signature: {
      label: helper.label,
      params: helper.params,
      activeParameter: call.argument,
      from: call.from,
      activePropertyPath: target?.path.length ? target.path : undefined,
    },
  }
}

/** Offers keys, an object starter, or configured literal values for an argument. */
export function argumentCompletions(
  request: CompletionRequest,
  target: ArgumentTarget,
): CompletionItem[] | undefined {
  if (target.key) return propertyCompletions(request, target.key)

  const { parameter, range } = target
  if (!parameter || !range) return
  const raw = request.text.slice(
    range.from,
    Math.min(range.to, request.text.length),
  )
  if (parameter.properties && !raw.trim()) {
    return [objectStarter(request.offset)]
  }

  const items = parameter.values
    ? argumentValues(request, range, parameter.values)
    : undefined

  return items?.length ? items : undefined
}

function objectStarter(offset: number): CompletionItem {
  return {
    label: '{}',
    kind: 'value',
    insertText: '{}',
    from: offset,
    to: offset,
    caretOffset: 1,
    retrigger: true,
  }
}
