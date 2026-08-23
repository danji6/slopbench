import { SCROLLBACK_LINES } from '@/lib/terminal-feed'
import { cn } from '@/lib/utils'
import { ANSI_COLOR_VARS } from '@sb/core/shell/ansi'
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from '@xterm/xterm'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react'

import { TERMINAL_BOX } from './terminal'

export type TerminalHandle = {
  write: (data: string) => void
  clear: () => void
  fit: () => void
}

export type TerminalProps = {
  ref?: Ref<TerminalHandle>
  readOnly?: boolean
  onData?: (data: string) => void
  onResize?: (cols: number, rows: number) => void
  onReady?: () => void
  className?: string
}

/**
 * Imperative xterm.js wrapper. Content is pushed through the handle rather
 * than passed as props, so streamed output never re-renders the tree.
 *
 * Loaded lazily through `./terminal` so xterm.js stays out of the entry chunk.
 */
export function TerminalView({
  ref,
  readOnly = false,
  onData,
  onResize,
  onReady,
  className,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Output can arrive through the handle before the terminal mounts
  const pendingRef = useRef('')

  const readOnlyRef = useRef(readOnly)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const onReadyRef = useRef(onReady)

  useEffect(() => {
    readOnlyRef.current = readOnly
    onDataRef.current = onData
    onResizeRef.current = onResize
    onReadyRef.current = onReady
  })

  useImperativeHandle(
    ref,
    () => ({
      write: (data: string) => {
        if (termRef.current) termRef.current.write(data)
        else pendingRef.current += data
      },
      clear: () => {
        pendingRef.current = ''
        termRef.current?.clear()
      },
      fit: () => fitRef.current?.fit(),
    }),
    [],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new XTerm({
      convertEol: false,
      cursorBlink: !readOnlyRef.current,
      disableStdin: readOnlyRef.current,
      fontFamily: readMonoFont(container),
      fontSize: 12,
      scrollback: SCROLLBACK_LINES,
      theme: readTerminalTheme(container),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    let lastWidth = -1
    let lastHeight = -1
    let frame = 0

    const refit = () => {
      frame = 0
      const width = container.clientWidth
      const height = container.clientHeight
      // Only refit when the container's measured size actually changed
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      fit.fit()
    }

    const scheduleRefit = () => {
      // Refit at most once per frame
      if (frame) return
      frame = requestAnimationFrame(refit)
    }

    refit()

    term.onData((data) => {
      if (!readOnlyRef.current) onDataRef.current?.(data)
    })
    term.onResize(({ cols, rows }) => onResizeRef.current?.(cols, rows))

    termRef.current = term
    fitRef.current = fit
    onReadyRef.current?.()

    if (pendingRef.current) {
      term.write(pendingRef.current)
      pendingRef.current = ''
    }

    const resizeObserver = new ResizeObserver(scheduleRefit)
    resizeObserver.observe(container)

    const unobserveTheme = observeThemeChange(() => {
      term.options.theme = readTerminalTheme(container)
      const fontFamily = readMonoFont(container)
      if (fontFamily && fontFamily !== term.options.fontFamily) {
        term.options.fontFamily = fontFamily
        fit.fit()
      }
    })
    const detachTouch = enableTouchScroll(term)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      unobserveTheme()
      detachTouch()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.disableStdin = readOnly
    term.options.cursorBlink = !readOnly
  }, [readOnly])

  return (
    <div
      ref={containerRef}
      data-slot="terminal"
      className={cn(TERMINAL_BOX, className)}
    />
  )
}

/** Reads the resolved `--font-mono` family so the canvas matches the
 * app's mono font setting (xterm can't inherit it from CSS). */
function readMonoFont(element: HTMLElement): string | undefined {
  const value = getComputedStyle(element).getPropertyValue('--font-mono').trim()
  return value || undefined
}

const CHROME_VARS = [
  '--surface-container-lowest',
  '--on-surface',
  '--primary',
  '--surface-container-low',
  '--outline-variant',
] as const

/** ITheme's ANSI slots, in the same order as `ANSI_COLOR_VARS`. */
const ANSI_THEME_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const

/** Turns M3's CSS color-mixes into concrete colors. */
function readTerminalTheme(element: HTMLElement): ITheme {
  const colors = resolveColors(element, [...CHROME_VARS, ...ANSI_COLOR_VARS])
  const ansi = Object.fromEntries(
    ANSI_THEME_KEYS.map((key, index) => [
      key,
      colors.get(ANSI_COLOR_VARS[index]!),
    ]),
  ) as Pick<ITheme, (typeof ANSI_THEME_KEYS)[number]>

  return {
    background: colors.get('--surface-container-lowest'),
    foreground: colors.get('--on-surface'),
    cursor: colors.get('--primary'),
    cursorAccent: colors.get('--surface-container-low'),
    selectionBackground: colors.get('--outline-variant'),
    ...ansi,
  }
}

/** Resolves CSS custom properties to concrete colors in a single recalc. */
function resolveColors(
  element: HTMLElement,
  variables: readonly string[],
): Map<string, string | undefined> {
  const unique = [...new Set(variables)]
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none'

  const spans = unique.map((variable) => {
    const span = document.createElement('span')
    span.style.color = `var(${variable})`
    probe.appendChild(span)
    return span
  })
  element.appendChild(probe)

  const colors = new Map(
    unique.map((variable, index) => [
      variable,
      getComputedStyle(spans[index]!).color || undefined,
    ]),
  )
  probe.remove()
  return colors
}

/** Re-reads the terminal theme whenever the source color changes. */
function observeThemeChange(onChange: () => void): () => void {
  let frame = 0
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      onChange()
    })
  }

  const rootObserver = new MutationObserver(schedule)
  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  })

  const headObserver = new MutationObserver(schedule)
  headObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  return () => {
    if (frame) cancelAnimationFrame(frame)
    rootObserver.disconnect()
    headObserver.disconnect()
  }
}

// TODO broken, fix
function enableTouchScroll(term: XTerm): () => void {
  const viewport = term.element?.querySelector<HTMLElement>('.xterm-viewport')
  if (!viewport) return () => {}

  viewport.style.overscrollBehavior = 'contain'

  let lastY = 0
  const onTouchStart = (event: TouchEvent) => {
    lastY = event.touches[0]?.clientY ?? 0
  }
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY ?? 0
    const delta = lastY - y
    lastY = y

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const atTop = scrollTop <= 0
    const atBottom = scrollTop + clientHeight >= scrollHeight - 1
    const canScroll = (delta < 0 && !atTop) || (delta > 0 && !atBottom)
    if (!canScroll) return

    viewport.scrollTop = scrollTop + delta
    event.preventDefault()
    event.stopPropagation()
  }

  viewport.addEventListener('touchstart', onTouchStart, { passive: true })
  viewport.addEventListener('touchmove', onTouchMove, { passive: false })

  return () => {
    viewport.removeEventListener('touchstart', onTouchStart)
    viewport.removeEventListener('touchmove', onTouchMove)
  }
}
