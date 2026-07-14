import { camelToDashCase, dashToCamelCase } from '@sb/core/utils/strings'
import {
  type DynamicScheme,
  Hct,
  QuantizerCelebi,
  SchemeContent,
  Score,
  argbFromHex,
  argbFromRgb,
  hexFromArgb,
} from '@material/material-color-utilities'
import { getFormat } from 'colord'

const MAX_QUANTIZER_SIZE = 256

const THEME_TRANSITION_MS = 500
const THEME_ANIM_CLASS = 'theme-anim'
const THEME_STYLE_ID = 'theme-transitions'
const DISABLE_THEME_ANIMATION = false

let instantNextApply = false
let themeAnimFrame = 0
let themeAnimTimeout = 0
let popupTransitionObserver: MutationObserver | null = null

/** Makes the next `applyTheme` update without transition animations. */
export function suppressNextThemeAnimation() {
  instantNextApply = true
}

export type ThemeMode = 'light' | 'dark' | 'system'

export type Theme = {
  sourceColor: string
  mode: ThemeMode
  contrast: number
  css: Record<string, string>
}

export type ThemeSnapshot = {
  source: string
  light: Record<string, string>
  dark: Record<string, string>
}

export const schemeProperties = [
  'sourceColor',
  'primaryPaletteKeyColor',
  'secondaryPaletteKeyColor',
  'tertiaryPaletteKeyColor',
  'neutralPaletteKeyColor',
  'neutralVariantPaletteKeyColor',
  'background',
  'onBackground',
  'surface',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'inverseSurface',
  'inverseOnSurface',
  'outline',
  'outlineVariant',
  'shadow',
  'scrim',
  'surfaceTint',
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'inversePrimary',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'primaryFixed',
  'primaryFixedDim',
  'onPrimaryFixed',
  'onPrimaryFixedVariant',
  'secondaryFixed',
  'secondaryFixedDim',
  'onSecondaryFixed',
  'onSecondaryFixedVariant',
  'tertiaryFixed',
  'tertiaryFixedDim',
  'onTertiaryFixed',
  'onTertiaryFixedVariant',
] as const

export type JsonScheme = Record<(typeof schemeProperties)[number], string>

export const schemePropertiesSet = new Set<string>(schemeProperties)

export type SchemeExport = {
  json: JsonScheme
  css: Record<string, string>
}

export function matchDarkMode(): MediaQueryList {
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export function isDarkModePreferred(): boolean {
  return matchDarkMode().matches
}

export function actualThemeMode(mode: ThemeMode): ThemeMode {
  return mode === 'system' ? preferredThemeMode() : mode
}

export function preferredThemeMode(): ThemeMode {
  return isDarkModePreferred() ? 'dark' : 'light'
}

export function nextThemeMode(curMode: ThemeMode): ThemeMode {
  if (curMode === 'system') {
    return isDarkModePreferred() ? 'light' : 'dark'
  }

  if (isDarkModePreferred()) {
    return curMode === 'light' ? 'dark' : 'system'
  } else {
    return curMode === 'dark' ? 'light' : 'system'
  }
}

export function generateScheme(
  sourceColor: string,
  mode: ThemeMode,
  contrast: number,
): DynamicScheme {
  // TODO add more scheme types
  return new SchemeContent(
    Hct.fromInt(argbFromHex(sourceColor)),
    actualThemeMode(mode) === 'dark',
    contrast,
  )
}

/** Worker-safe version of `generateScheme` (no match-media use) */
export function exportSchemeCss(
  sourceColor: string,
  isDark: boolean,
  contrast: number,
): SchemeExport {
  const scheme = new SchemeContent(
    Hct.fromInt(argbFromHex(sourceColor)),
    isDark,
    contrast,
  )
  return exportScheme(scheme)
}

export function sourceColorFromBytes(bytes: Uint8ClampedArray) {
  const pixels: number[] = []
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i]
    const g = bytes[i + 1]
    const b = bytes[i + 2]
    const a = bytes[i + 3]
    if (a < 255) continue
    const argb = argbFromRgb(r, g, b)
    pixels.push(argb)
  }

  const result = QuantizerCelebi.quantize(pixels, MAX_QUANTIZER_SIZE)
  const ranked = Score.score(result)
  const top = ranked[0]

  return hexFromArgb(top)
}

export function sourceColorFromBitmap(bitmap: ImageBitmap): string {
  const canvas = new OffscreenCanvas(MAX_QUANTIZER_SIZE, MAX_QUANTIZER_SIZE)
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })

  if (!ctx) {
    throw new Error('Failed to get canvas 2d context')
  }

  const r = Math.min(
    MAX_QUANTIZER_SIZE / bitmap.width,
    MAX_QUANTIZER_SIZE / bitmap.height,
  )
  const w = bitmap.width * r
  const h = bitmap.height * r

  ctx.drawImage(bitmap, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' })

  return sourceColorFromBytes(imageData.data)
}

export function exportScheme(scheme: DynamicScheme): SchemeExport {
  const json = {} as JsonScheme
  const css: Record<string, string> = {}

  let currentProto = Object.getPrototypeOf(scheme)

  while (currentProto && currentProto !== Object.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(currentProto)

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (
        key === 'constructor' ||
        !descriptor.get ||
        key in json ||
        !schemePropertiesSet.has(key)
      ) {
        continue
      }

      const value = descriptor.get.call(scheme)

      if (typeof value === 'number') {
        const hex = hexFromArgb(value)
        const cssKey = `--${camelToDashCase(key)}`
        json[key as keyof JsonScheme] = hex
        css[cssKey] = hex
      }
    }

    currentProto = Object.getPrototypeOf(currentProto)
  }

  const sourceColor = hexFromArgb(scheme.sourceColorArgb)
  json.sourceColor = sourceColor
  css['--source-color'] = sourceColor

  return { json, css }
}

/**
 * Registers the scheme variables as `<color>` via `@property` so the browser
 * can interpolate them.
 */
function registerTransitions() {
  if (typeof document === 'undefined') return
  if (document.getElementById(THEME_STYLE_ID)) return

  const names = ['--background', '--primary', '--secondary']

  const properties = names
    .map(
      (name) =>
        `@property ${name}{syntax:"<color>";inherits:true;initial-value:#000;}`,
    )
    .join('')

  const transition =
    `html.${THEME_ANIM_CLASS}{` +
    `transition-property:${names.join(',')};` +
    `transition-duration:${THEME_TRANSITION_MS}ms;` +
    `transition-timing-function:ease;}`

  const style = document.createElement('style')
  style.id = THEME_STYLE_ID
  style.textContent = properties + transition

  document.head.appendChild(style)
}

function clearThemeAnimation(root: HTMLElement) {
  if (themeAnimFrame) {
    cancelAnimationFrame(themeAnimFrame)
    themeAnimFrame = 0
  }

  if (themeAnimTimeout) {
    clearTimeout(themeAnimTimeout)
    themeAnimTimeout = 0
  }

  root.classList.remove(THEME_ANIM_CLASS)
}

function isPopupTransitioning() {
  return Boolean(
    document.querySelector('[data-starting-style], [data-ending-style]'),
  )
}

function registerPopupTransitionObserver() {
  if (popupTransitionObserver) return

  popupTransitionObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.target instanceof HTMLElement &&
        (mutation.target.hasAttribute('data-starting-style') ||
          mutation.target.hasAttribute('data-ending-style'))
      ) {
        clearThemeAnimation(document.documentElement)
        return
      }
    }
  })

  popupTransitionObserver.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-starting-style', 'data-ending-style'],
  })
}

function prepareTransitions() {
  if (typeof document === 'undefined') return

  registerPopupTransitionObserver()

  const root = document.documentElement
  const shouldAnimate =
    !DISABLE_THEME_ANIMATION && !instantNextApply && !isPopupTransitioning()

  instantNextApply = false

  if (!shouldAnimate) {
    clearThemeAnimation(root)
    return
  }

  clearThemeAnimation(root)
  root.classList.add(THEME_ANIM_CLASS)

  // Make sure the transition rule is active before the CSS variables change
  root.getBoundingClientRect()

  themeAnimFrame = requestAnimationFrame(() => {
    themeAnimFrame = 0
    themeAnimTimeout = window.setTimeout(() => {
      themeAnimTimeout = 0
      root.classList.remove(THEME_ANIM_CLASS)
    }, THEME_TRANSITION_MS)
  })
}

export function applyTheme(theme: Theme, className?: string) {
  const root = window.document.documentElement
  const style = root.style

  registerTransitions()
  prepareTransitions()

  if (className) {
    const styleId = `style-${className}`
    let style = document.getElementById(styleId)

    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }

    let cssContent = `.${className} {`
    for (const [property, value] of Object.entries(theme.css)) {
      cssContent += `${property}: ${value};`
    }
    cssContent += '}'
    style.textContent = cssContent
  } else {
    for (const [property, value] of Object.entries(theme.css)) {
      style.setProperty(property, value)
    }

    if (actualThemeMode(theme.mode) === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }

  window.dispatchEvent(new Event('stylechange'))
}

export function removeTheme(className?: string) {
  const style = document.documentElement.style

  if (className) {
    const styleId = `style-${className}`
    const style = document.getElementById(styleId)

    if (style) {
      style.remove()
    }
  } else {
    for (const property of schemePropertiesSet.keys()) {
      style.removeProperty(`--${camelToDashCase(property)}`)
    }
  }

  window.dispatchEvent(new Event('stylechange'))
}

export function readScheme(): JsonScheme {
  const scheme: Record<string, string> = {}
  const style = getComputedStyle(document.documentElement)

  for (let i = 0; i < style.length; i++) {
    const prop = style[i]
    const propName = dashToCamelCase(prop.replace('--', ''))

    if (schemePropertiesSet.has(propName)) {
      scheme[propName] = style.getPropertyValue(prop).trim()
    }
  }

  return scheme as JsonScheme
}

export function schemeToCssVars(scheme: Record<string, string>): string {
  let declarations = ''
  for (const [property, value] of Object.entries(scheme)) {
    declarations += `${property}:${value};`
  }
  return declarations
}

export function hexColorOrNull(color: string | null | undefined) {
  if (!color || getFormat(color) !== 'hex') {
    return null
  }

  return color
}

export function isHexColor(color: string | null | undefined): color is string {
  return hexColorOrNull(color) !== null
}
