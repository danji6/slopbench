import { getFontFamily, getMonoFontFamily } from '@/fonts'
import { useSettings } from '@/hooks/chat/settings'
import {
  type SettingsOverride,
  getSettingsOverride,
  subscribeSettingsOverride,
} from '@/lib/settings-override'
import {
  DEFAULT_SETTINGS,
  type ResolvedSettings,
} from '@sb/convex/model/defaults'
import { useEffect, useSyncExternalStore } from 'react'

export type FontPreview = { uiFont?: string | null }

export type ResolvedFonts = {
  uiFont: string
  monoFont: string
  chatFont: string
  chatFontSize: number
}

/** Settings fields covered by the device-local font override. */
export const FONT_OVERRIDE_KEYS = [
  'uiFont',
  'monoFont',
  'chatFont',
  'chatFontSize',
] as const

export function useSettingsOverride(): SettingsOverride {
  return useSyncExternalStore(
    subscribeSettingsOverride,
    getSettingsOverride,
    getSettingsOverride,
  )
}

/** Resolves effective font values from synced settings + local override. */
export function resolveFonts(
  settings: ResolvedSettings | undefined,
  override: SettingsOverride,
): ResolvedFonts {
  return {
    uiFont: override.uiFont ?? settings?.uiFont ?? DEFAULT_SETTINGS.uiFont,
    monoFont:
      override.monoFont ?? settings?.monoFont ?? DEFAULT_SETTINGS.monoFont,
    chatFont:
      override.chatFont ?? settings?.chatFont ?? DEFAULT_SETTINGS.chatFont,
    chatFontSize:
      override.chatFontSize ??
      settings?.chatFontSize ??
      DEFAULT_SETTINGS.chatFontSize,
  }
}

export function useResolvedFonts(): ResolvedFonts {
  return resolveFonts(useSettings(), useSettingsOverride())
}

let fontPreview: FontPreview = {}
const previewListeners = new Set<() => void>()

export function useFontPreview(): FontPreview {
  return useSyncExternalStore(
    (listener) => {
      previewListeners.add(listener)
      return () => previewListeners.delete(listener)
    },
    () => fontPreview,
    () => fontPreview,
  )
}

export function setFontPreview(next: FontPreview | null) {
  fontPreview = next ?? {}
  previewListeners.forEach((listener) => listener())
}

export function useFont(font: string) {
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--font-sans',
      getFontFamily(font),
    )
  }, [font])
}

export function useMonoFont(font: string) {
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--font-mono',
      getMonoFontFamily(font),
    )
  }, [font])
}
