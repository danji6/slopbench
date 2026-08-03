import { useInsertionEffect, useMemo } from 'react'

export type Look = {
  css?: string
  /** Palette declarations for the scope root, from the sender's theme. */
  vars?: string
  /** Whether `vars` holds a dark theme. */
  isDark?: boolean
}

export type Scope = {
  /** Identifies the stylesheet. */
  key: string
  className: string
  rule: string
}

/** The scope `look` is mounted under, derived from the rule it produces. */
export function scopedAppearance({ css, vars, isDark }: Look): Scope | null {
  if (!css && !vars) return null

  const key = `cc-${(css?.length ?? 0).toString(36)}-${hash(`${vars ?? ''}\0${css ?? ''}`)}`

  return {
    key,
    className: vars ? `${key} theme-scope ${isDark ? 'dark' : 'light'}` : key,
    rule: [vars && `.${key}{${vars}}`, css && `@scope (.${key}) {\n${css}\n}`]
      .filter(Boolean)
      .join('\n'),
  }
}

const sheets = new Map<string, { element: HTMLStyleElement; refs: number }>()

function acquire({ key, rule }: Scope) {
  const entry = sheets.get(key)
  if (entry) {
    entry.refs += 1
    return
  }

  const element = document.createElement('style')
  element.dataset.appearanceScope = key
  element.textContent = rule
  // Append last for highest priority
  document.head.append(element)
  sheets.set(key, { element, refs: 1 })
}

function release({ key }: Scope) {
  const entry = sheets.get(key)
  if (!entry) return

  entry.refs -= 1
  if (entry.refs > 0) return

  entry.element.remove()
  sheets.delete(key)
}

/**
 * Mounts `look` once and returns the scope root classes, or `undefined` when
 * there is nothing to scope.
 */
export function useScopedAppearance({
  css,
  vars,
  isDark,
}: Look): string | undefined {
  const scope = useMemo(
    () => scopedAppearance({ css, vars, isDark }),
    [css, vars, isDark],
  )

  // Insertion because the class must never be painted before its rule
  useInsertionEffect(() => {
    if (!scope) return
    acquire(scope)
    return () => release(scope)
  }, [scope])

  return scope?.className
}

/** FNV-1a. Paired with the length above, collisions are not a concern here. */
function hash(value: string): string {
  let result = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i)
    result = Math.imul(result, 0x01000193)
  }
  return (result >>> 0).toString(36)
}
