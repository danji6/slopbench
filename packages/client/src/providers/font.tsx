import {
  useFont,
  useFontPreview,
  useMonoFont,
  useResolvedFonts,
} from '@/hooks/font'

export function FontProvider({ children }: { children: React.ReactNode }) {
  const preview = useFontPreview()
  const fonts = useResolvedFonts()
  useFont(preview.uiFont ?? fonts.uiFont)
  useMonoFont(fonts.monoFont)
  return <>{children}</>
}
