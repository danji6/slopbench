import { cn } from '@/lib/utils'
import { FitAddon } from '@xterm/addon-fit'
import type { ITheme } from '@xterm/xterm'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react'

const SCROLLBACK_LINES = 5000

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
    fit.fit()

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

    const resizeObserver = new ResizeObserver(() => fit.fit())
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
      className={cn('h-72 overflow-hidden', className)}
    />
  )
}

/** Reads the resolved `--font-mono` family so the canvas matches the
 * app's mono font setting (xterm can't inherit it from CSS). */
function readMonoFont(element: HTMLElement): string | undefined {
  const value = getComputedStyle(element).getPropertyValue('--font-mono').trim()
  return value || undefined
}

/** Turns M3's CSS color-mixes into concrete colors. */
function readTerminalTheme(element: HTMLElement): ITheme {
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  element.appendChild(probe)

  const resolve = (variable: string) => {
    probe.style.color = ''
    probe.style.color = `var(${variable})`
    if (!probe.style.color) return undefined
    return getComputedStyle(probe).color || undefined
  }

  const theme: ITheme = {
    background: resolve('--surface-container-lowest'),
    foreground: resolve('--on-surface'),
    cursor: resolve('--primary'),
    cursorAccent: resolve('--surface-container-low'),
    selectionBackground: resolve('--outline-variant'),

    black: resolve('--surface-container-low'),
    red: resolve('--shiki-red'),
    green: resolve('--shiki-green'),
    yellow: resolve('--shiki-yellow'),
    blue: resolve('--shiki-blue'),
    magenta: resolve('--shiki-purple'),
    cyan: resolve('--shiki-cyan'),
    white: resolve('--on-surface-variant'),

    brightBlack: resolve('--outline'),
    brightRed: resolve('--shiki-red'),
    brightGreen: resolve('--shiki-green'),
    brightYellow: resolve('--shiki-yellow'),
    brightBlue: resolve('--shiki-blue'),
    brightMagenta: resolve('--shiki-pink'),
    brightCyan: resolve('--shiki-cyan'),
    brightWhite: resolve('--on-surface'),
  }

  probe.remove()
  return theme
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
