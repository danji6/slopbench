import { getQuickJS, getQuickJSSync } from 'quickjs-emscripten'
import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten'

import { SESSION_ENV_NAMES } from './env'
import type { EvalHelpers } from './evaluate'
import { EVAL_LIMITS } from './limits'
import type { EvalContext, JsonValue, VariableStore } from './types'

/** Loads the isolated engine before synchronous rendering inside a worker. */
export const initializeEvaluator = getQuickJS

/** Creates a fresh guest with copied values and explicitly bridged helpers. */
export function createSandbox(
  context: EvalContext,
  store: VariableStore,
  helpers: EvalHelpers,
) {
  const runtime = getQuickJSSync().newRuntime()
  runtime.setMemoryLimit(EVAL_LIMITS.memoryBytes)
  runtime.setMaxStackSize(EVAL_LIMITS.stackBytes)
  const deadline = Date.now() + EVAL_LIMITS.executionMs
  runtime.setInterruptHandler(() => Date.now() >= deadline)
  const vm = runtime.newContext()

  try {
    bindContext(vm, context)
    bindHelpers(vm, store, helpers)
  } catch (error) {
    vm.dispose()
    runtime.dispose()
    throw error
  }

  return {
    run(body: string): unknown {
      const source = `(function(${SESSION_ENV_NAMES.join(',')}) {${body}\n})(${SESSION_ENV_NAMES.join(',')})`
      const result = vm.evalCode(source)
      if (result.error) {
        result.error.dispose()
        // Guest error objects can themselves have hostile getters/stringifiers.
        throw new Error(
          'Dynamic JavaScript failed or exceeded its resource limit',
        )
      }
      try {
        return vm.dump(result.value)
      } finally {
        result.value.dispose()
      }
    },
    dispose() {
      vm.dispose()
      runtime.dispose()
    },
  }
}

function bindContext(vm: QuickJSContext, context: EvalContext) {
  const values = {
    ...context,
    agent: context.assistant,
    assistant: context.assistant,
    char: context.assistant,
    ai: context.assistant,
    tools: context.tools ?? [],
    isAdmin: context.isAdmin ?? false,
    userCount: context.userCount ?? 0,
    agentCount: context.agentCount ?? 0,
  }
  for (const name of SESSION_ENV_NAMES) {
    const value = values[name as keyof typeof values]
    const handle = jsonHandle(vm, value)
    vm.setProp(vm.global, name, handle)
    handle.dispose()
  }
}

function bindHelpers(
  vm: QuickJSContext,
  store: VariableStore,
  helpers: EvalHelpers,
) {
  const functions = {
    getVar: (key: QuickJSHandle) =>
      jsonHandle(vm, store.get(stringArg(vm, key))),
    setVar: (key: QuickJSHandle, value: QuickJSHandle) => {
      const data: unknown = vm.dump(value)
      // JSON transfer prevents guest objects or functions crossing into the host.
      const encoded = JSON.stringify(data)
      if (encoded === undefined) throw new Error('setVar requires a JSON value')
      store.set(stringArg(vm, key), JSON.parse(encoded) as JsonValue)
      return vm.undefined
    },
    readFile: (path: QuickJSHandle, wrap?: QuickJSHandle) =>
      vm.newString(
        helpers.readFile?.(
          stringArg(vm, path),
          !wrap || vm.typeof(wrap) === 'undefined'
            ? undefined
            : vm.dump(wrap) !== false,
        ) ?? '',
      ),
    fileExists: (path: QuickJSHandle) =>
      helpers.fileExists?.(stringArg(vm, path)) ? vm.true : vm.false,
  }
  for (const [name, callback] of Object.entries(functions)) {
    const handle = vm.newFunction(name, callback)
    vm.setProp(vm.global, name, handle)
    handle.dispose()
  }
}

function stringArg(vm: QuickJSContext, value: QuickJSHandle): string {
  if (!value || vm.typeof(value) !== 'string')
    throw new Error('Expected a string argument')
  return vm.getString(value)
}

function jsonHandle(vm: QuickJSContext, value: unknown): QuickJSHandle {
  if (value === undefined) return vm.undefined.dup()
  return vm.unwrapResult(vm.evalCode(`(${JSON.stringify(value)})`))
}
