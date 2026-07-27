import { createOptionalContext } from '@/hooks/context'

const [ThemeScopeContext, useThemeScope] = createOptionalContext<string>()

/** Provides a scoped theme's class down the tree so that popups can opt into it. */
export function ThemeScope({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <ThemeScopeContext.Provider value={className ?? null}>
      {children}
    </ThemeScopeContext.Provider>
  )
}

export { useThemeScope }
