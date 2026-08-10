import { useEffect } from 'react'

const latched = new Set<string>()

/**
 * Latches `true` the first time `trigger` fires for `key`, surviving remounts.
 * Lets components keep state when they unmount and remount.
 */
export function useLatch(key: string, trigger: boolean): boolean {
  useEffect(() => {
    if (trigger) latched.add(key)
  }, [trigger, key])
  return trigger || latched.has(key)
}
