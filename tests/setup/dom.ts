import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll } from 'bun:test'

/**
 * Installs a DOM for the calling test file.
 *
 * Not a global preload: happy-dom also replaces stream and fetch globals,
 * which breaks the SSE and provider-stream suites. Editor code silently falls
 * back to stringly behavior when `window.DOMParser` is missing, so anything
 * touching Tiptap has to opt in here to be tested for real.
 */
export function setupDom(): void {
  beforeAll(() => {
    const NativeResponse = globalThis.Response
    GlobalRegistrator.register()
    // Shiki reads its compressed WASM with Response.bytes(), which Happy DOM lacks.
    globalThis.Response = NativeResponse

    // Wouter patches history once at import time; every fresh DOM needs the same events.
    const patchKey = Symbol.for('wouter_v3')
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = window.history[method]
      window.history[method] = function (...args) {
        original.apply(this, args)
        window.dispatchEvent(new Event(method))
      }
    }
    Object.defineProperty(window, patchKey, { value: true })
  })
  afterAll(() => GlobalRegistrator.unregister())
}

/** Installs a DOM and restores React's act flag after the calling test file. */
export function setupReactDom(): void {
  setupDom()
  let previous: PropertyDescriptor | undefined
  beforeAll(() => {
    previous = Object.getOwnPropertyDescriptor(
      globalThis,
      'IS_REACT_ACT_ENVIRONMENT',
    )
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  })
  afterAll(() => {
    if (previous)
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previous)
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  })
}
