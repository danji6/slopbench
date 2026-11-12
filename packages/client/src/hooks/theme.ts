import { useWorker } from '@/hooks/worker'
import {
  type ThemeMode,
  applyTheme,
  hexColorOrNull,
  isDarkModePreferred,
  matchDarkMode,
  removeTheme,
  suppressNextThemeAnimation,
} from '@/lib/theme'
import { generateThemeCss } from '@/lib/theme-worker'
import { imageLoad } from '@/lib/utils'
import { ThemeWorker, type ThemeWorkerApi, type WorkerApi } from '@/workers'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

const classRegistry = new Map<
  string,
  { count: number; initiallyHad: boolean }
>()

/**
 * Main hook for Material 3 theme generation.
 */
export function useTheme(
  color?: string | null,
  className = 'you',
  mode?: ThemeMode | null,
) {
  const [override, setOverride] = useState<string | null | undefined>(undefined)
  const sourceColor = override !== undefined ? override : hexColorOrNull(color)
  const systemIsDark = useIsDarkModePreferred()
  const requestedMode = mode ?? 'system'
  const isDark = requestedMode === 'system' ? systemIsDark : requestedMode === 'dark' // prettier-ignore
  const appliesDocumentMode = mode != null

  useLayoutEffect(() => {
    if (!appliesDocumentMode) return

    const root = document.documentElement
    root.classList.toggle('dark', isDark)
    return () => {
      root.classList.toggle('dark', isDarkModePreferred())
    }
  }, [appliesDocumentMode, isDark])

  useClassName(sourceColor ? className : null)

  const apply = useCallback((next: string | null | undefined) => {
    setOverride(hexColorOrNull(next))
  }, [])

  useEffect(() => {
    if (!sourceColor) {
      removeTheme(className)
      return
    }

    let cancelled = false
    const resolvedMode = isDark ? 'dark' : 'light'

    generateThemeCss(sourceColor, isDark).then(({ css }) => {
      if (cancelled) return
      applyTheme(
        { sourceColor, mode: resolvedMode, contrast: 0, css },
        className,
      )
    })

    return () => {
      cancelled = true
    }
  }, [sourceColor, className, isDark])

  useEffect(() => () => removeTheme(className), [className])

  return [sourceColor, apply] as const
}

/**
 * Uses the dominant color from an image as the source color for a theme scope.
 */
export function useQuantizedTheme(
  image?: HTMLImageElement | null,
  className = 'quantized',
): string | null {
  const [sourceColor, apply] = useTheme(undefined, className)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    if (image !== undefined) {
      apply(null)
    }
  }, [image, apply])

  const callback = useCallback(
    async (worker: WorkerApi<ThemeWorkerApi>) => {
      if (!image) return
      const currentImage = image
      await imageLoad(currentImage)

      try {
        const bitmap = await createImageBitmap(currentImage, {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
        })
        const color = await worker.api.sourceColorFromBitmap(bitmap)

        if (isMounted.current && image === currentImage) {
          apply(color)
        }
      } catch (error) {
        console.error('Failed to generate theme from image', error)
      }
    },
    [apply, image],
  )

  const [generate] = useWorker(ThemeWorker, { callback })

  useEffect(() => {
    if (!image || sourceColor) return
    generate()
  }, [generate, image, sourceColor])

  return sourceColor
}

export function useDarkMode() {
  return useClassName('dark')
}

export function useDefaultTheme() {
  useEffect(() => {
    removeTheme()
  }, [])
}

/**
 * A theme for one subtree, returned as the class to put on its root.
 *
 * @param `mode` overrides the document's light/dark.
 */
export function useScopedTheme(
  color?: string | null,
  mode?: ThemeMode | null,
): string | undefined {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const className = `theme-${id}`
  const sourceColor = hexColorOrNull(color)
  const documentIsDark = useIsDarkMode()
  const systemIsDark = useIsDarkModePreferred()
  const isDark = mode
    ? mode === 'dark' || (mode === 'system' && systemIsDark)
    : documentIsDark

  // Asynchronous guard while the worker generates the theme
  const [installed, setInstalled] = useState<'light' | 'dark'>()
  if (!sourceColor && installed) setInstalled(undefined)

  useEffect(() => {
    if (!sourceColor) {
      removeTheme(className)
      return
    }

    let cancelled = false
    const scopeMode = isDark ? 'dark' : 'light'

    generateThemeCss(sourceColor, isDark).then(({ css }) => {
      if (cancelled) return
      suppressNextThemeAnimation() // a scope repaints on its own
      applyTheme({ sourceColor, mode: scopeMode, contrast: 0, css }, className)
      setInstalled(scopeMode)
    })

    return () => {
      cancelled = true
    }
  }, [className, sourceColor, isDark])

  useEffect(() => () => removeTheme(className), [className])

  if (!sourceColor || !installed) return undefined
  return `theme-scope ${className} ${installed}`
}

export function useClassName(className: string | null | undefined) {
  useEffect(() => {
    if (!className) return
    const root = document.documentElement
    let entry = classRegistry.get(className)

    if (!entry) {
      const initiallyHad = root.classList.contains(className)
      entry = { count: 0, initiallyHad }
      classRegistry.set(className, entry)
    }

    entry.count++
    if (!entry.initiallyHad) {
      root.classList.add(className)
    }

    return () => {
      const entry = classRegistry.get(className)
      if (entry) {
        entry.count--
        if (entry.count <= 0) {
          if (!entry.initiallyHad) {
            root.classList.remove(className)
          }
          classRegistry.delete(className)
        }
      }
    }
  }, [className])
}

export function useIsDarkMode(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const root = document.documentElement
      const observer = new MutationObserver(listener)
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['class'],
      })
      return () => observer.disconnect()
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )
}

function subscribeToColorScheme(listener: () => void) {
  const media = matchDarkMode()
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

export function useIsDarkModePreferred() {
  return useSyncExternalStore(
    subscribeToColorScheme,
    isDarkModePreferred,
    () => false,
  )
}
