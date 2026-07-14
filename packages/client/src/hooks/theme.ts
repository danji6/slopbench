import { useWorker } from '@/hooks/worker'
import {
  type ThemeMode,
  actualThemeMode,
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
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

export type ThemePreview = {
  themeColor?: string | null
  themeMode?: ThemeMode | null
}

let themePreview: ThemePreview = {}
const previewListeners = new Set<() => void>()

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
    const resolvedMode = mode ?? 'system'
    const isDark = actualThemeMode(resolvedMode) === 'dark'

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
  }, [sourceColor, className, mode])

  useEffect(() => () => removeTheme(className), [className])

  const appModeRef = useRef<ThemeMode>('system')
  useEffect(() => {
    if (!mode || !sourceColor) return

    const root = document.documentElement
    const sync = () => {
      const isDark =
        mode === 'dark' || (mode === 'system' && isDarkModePreferred())
      root.classList.toggle('dark', isDark)
    }

    sync()
    window.addEventListener('stylechange', sync)

    return () => {
      window.removeEventListener('stylechange', sync)
      const isDark =
        appModeRef.current === 'dark' ||
        // eslint-disable-next-line react-hooks/exhaustive-deps
        (appModeRef.current === 'system' && isDarkModePreferred())
      root.classList.toggle('dark', isDark)
    }
  }, [mode, sourceColor])

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

export function useThemePreview(): ThemePreview {
  return useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener)
      return () => previewListeners.delete(listener)
    },
    () => themePreview,
    () => themePreview,
  )
}

export function setThemePreview(next: ThemePreview | null) {
  themePreview = next ?? {}
  suppressNextThemeAnimation()
  previewListeners.forEach((listener) => listener())
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

export function useIsDarkModePreferred() {
  const [isDark, setDark] = useState(() =>
    typeof window !== 'undefined' ? isDarkModePreferred() : false,
  )

  useEffect(() => {
    function handleChange(e: MediaQueryListEvent) {
      setDark(e.matches)
    }

    const m = matchDarkMode()
    m.addEventListener('change', handleChange)

    return () => {
      m.removeEventListener('change', handleChange)
    }
  }, [])

  return isDark
}
