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
  beforeAll(() => GlobalRegistrator.register())
  afterAll(() => GlobalRegistrator.unregister())
}
