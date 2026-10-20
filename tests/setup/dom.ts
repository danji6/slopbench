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
    GlobalRegistrator.register()
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
