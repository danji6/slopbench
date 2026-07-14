
import { useEffect, useRef, useState } from 'react'

/**
 * A hook that abstracts the logic of delayed changes within inputs
 * @param onChange The function to call when the step changes
 * @param delay The delay in milliseconds between steps
 * @returns
 */
export function useStep(
  onChange: (direction: number) => void,
  delay = 200,
  minDelay = 30,
) {
  const [stepDirection, setStepDirection] = useState(0)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (stepDirection === 0) return

    let currentDelay = delay
    let timeoutId: NodeJS.Timeout

    function step() {
      onChangeRef.current(stepDirection)
      currentDelay = Math.max(currentDelay * 0.8, minDelay)
      timeoutId = setTimeout(step, currentDelay)
    }

    onChangeRef.current(stepDirection)
    timeoutId = setTimeout(step, currentDelay)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [stepDirection, delay, minDelay])

  return [stepDirection, setStepDirection] as const
}
