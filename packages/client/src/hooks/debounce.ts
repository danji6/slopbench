import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Becomes true once `active` has held continuously for `delay` ms, and drops
 * back to false the moment `active` does. Useful to avoid flashing transient UI
 * (loaders, indicators) for states that are usually resolved almost instantly.
 */
export function useDelayedFlag(active: boolean, delay = 1000): boolean {
  const [flag, setFlag] = useState(false)

  if (!active && flag) setFlag(false)

  useEffect(() => {
    if (!active || flag) return
    const timer = setTimeout(() => setFlag(true), delay)
    return () => clearTimeout(timer)
  }, [active, delay, flag])

  return flag
}

export function useDebouncedState<T>(
  initialValue: T,
  defaultDelay = 300,
): [T, (value: T, delay?: number) => void] {
  const [value, setValue] = useState(initialValue)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setDebouncedValue = useCallback(
    (newValue: T, delay = defaultDelay) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      if (delay <= 0) {
        setValue(newValue)
        return
      }

      timeoutRef.current = setTimeout(() => {
        setValue(newValue)
      }, delay)
    },
    [defaultDelay],
  )

  return [value, setDebouncedValue] as const
}

export function useDebouncedCallback<TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  defaultDelay = 300,
) {
  const callbackRef = useRef(callback)
  const lastArgsRef = useRef<TArgs | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const cancel = useCallback(() => {
    if (!timeoutRef.current) return
    clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  const run = useCallback(
    (...args: TArgs) => {
      lastArgsRef.current = args
      cancel()
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        const pendingArgs = lastArgsRef.current
        lastArgsRef.current = null
        if (pendingArgs) callbackRef.current(...pendingArgs)
      }, defaultDelay)
    },
    [cancel, defaultDelay],
  )

  const flush = useCallback(
    (...args: TArgs | []) => {
      const pendingArgs =
        args.length > 0 ? (args as TArgs) : lastArgsRef.current
      cancel()
      lastArgsRef.current = null
      if (pendingArgs) callbackRef.current(...pendingArgs)
    },
    [cancel],
  )

  useEffect(() => cancel, [cancel])

  return useMemo(() => ({ cancel, flush, run }), [cancel, flush, run])
}

export function useDebouncedCommitState<T>(
  value: T,
  onCommit: (value: T) => void,
  {
    delay = 300,
    resetKey,
  }: {
    delay?: number
    resetKey?: unknown
  } = {},
) {
  const [draft, setDraft] = useState(value)
  const [prevValue, setPrevValue] = useState(value)
  const [prevResetKey, setPrevResetKey] = useState(resetKey)
  const commit = useDebouncedCallback(
    (nextValue: T, scheduledResetKey: unknown) => {
      if (!Object.is(scheduledResetKey, resetKey)) return
      onCommit(nextValue)
    },
    delay,
  )

  if (!Object.is(value, prevValue) || !Object.is(resetKey, prevResetKey)) {
    setPrevValue(value)
    setPrevResetKey(resetKey)
    setDraft(value)
  }

  const setValue = useCallback(
    (nextValue: T) => {
      setDraft(nextValue)
      commit.run(nextValue, resetKey)
    },
    [commit, resetKey],
  )

  const flush = useCallback(() => {
    commit.flush(draft, resetKey)
  }, [commit, draft, resetKey])

  return [draft, setValue, flush] as const
}
