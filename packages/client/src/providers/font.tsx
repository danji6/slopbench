import { useFont, useMonoFont, useResolvedFonts } from '@/hooks/font'

export function FontProvider({ children }: { children: React.ReactNode }) {
  const fonts = useResolvedFonts()
  useFont(fonts.uiFont)
  useMonoFont(fonts.monoFont)
  return <>{children}</>
}
