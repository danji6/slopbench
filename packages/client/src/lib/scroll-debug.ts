// Keep diagnostics paused even in tabs with a saved debug preference.
const SCROLL_DEBUG_ENABLED = false

/** Enables diagnostics for this tab, including across page refreshes. */
function enabled() {
  if (!SCROLL_DEBUG_ENABLED) return false
  try {
    return (
      typeof window !== 'undefined' &&
      sessionStorage.getItem('scroll-debug') === '1'
    )
  } catch {
    return false
  }
}

export const SCROLL_DEBUG = enabled()
const MAX_ENTRIES = 3000
const entries: Record<string, unknown>[] = []
const previous = new Map<string, string>()

/** Identifies the caller without collecting message content. */
export function scrollDebugSource() {
  return new Error().stack
    ?.split('\n')
    .slice(2)
    .filter((line) => !/scroll-debug\.|scroll-target\./.test(line))
    .slice(0, 4)
    .map((line) => line.trim())
}

/** Records immutable geometry and lifecycle events only when explicitly enabled. */
export function scrollDebug(
  event: string,
  details: () => Record<string, unknown> = () => ({}),
) {
  if (!SCROLL_DEBUG) return
  const data = {
    y: window.scrollY,
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    ...details(),
  }
  const signature = JSON.stringify(data)
  if (previous.get(event) === signature) return
  previous.set(event, signature)
  const entry = { ms: Math.round(performance.now()), event, ...data }
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) entries.shift()
  console.log(`[scroll] ${JSON.stringify(entry)}`)
}

/** Samples mounted rows to distinguish an empty virtual range from offscreen content. */
export function scrollDebugFrame() {
  scrollDebug('viewport.frame', () => {
    const mounted = [
      ...document.querySelectorAll<HTMLElement>('[data-row-key]'),
    ].map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        key: element.dataset.rowKey,
        top: rect.top,
        height: rect.height,
        bottom: rect.bottom,
      }
    })
    const visible = mounted.filter(
      (row) => row.height > 0 && row.bottom > 0 && row.top < window.innerHeight,
    )
    return {
      mounted: mounted.length,
      visible: visible.length,
      first: mounted[0],
      last: mounted.at(-1),
      firstVisible: visible[0],
    }
  })
}

if (SCROLL_DEBUG) {
  Reflect.set(window, '__scrollDebug', {
    dump: () =>
      JSON.stringify(
        {
          timeOrigin: performance.timeOrigin,
          userAgent: navigator.userAgent,
          entries,
        },
        null,
        2,
      ),
    clear: () => {
      entries.length = 0
      previous.clear()
    },
  })
  window.addEventListener('scroll', () => scrollDebug('viewport.scroll'), {
    passive: true,
  })
  window.addEventListener('pagehide', () => scrollDebug('viewport.pagehide'))
  scrollDebug('debug.ready')
}
