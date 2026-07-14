
import type { MorpherOptions, RoundedPolygon } from '@/lib/shapes'
import { Morpher } from '@/lib/shapes'
import { useEffect, useRef } from 'react'

export function useMorph(
  canvas: HTMLCanvasElement | null | undefined,
  shapes: RoundedPolygon[],
  options?: MorpherOptions,
) {
  const morpherRef = useRef<Morpher | null>(null)
  const hasStartedRef = useRef(false)

  useEffect(() => {
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const morpher = new Morpher(ctx, shapes, options)
    morpherRef.current = morpher
    hasStartedRef.current = false

    return () => {
      morpher.stop()
      morpherRef.current = null
      hasStartedRef.current = false
    }
    // Options shouldn't reinitialize the morpher
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, shapes])

  // Allow options to be updated without reinitializing the morpher
  useEffect(() => {
    if (!morpherRef.current) return

    if (options) {
      morpherRef.current.setOptions(options)
    }

    if (!hasStartedRef.current) {
      morpherRef.current.start()
      hasStartedRef.current = true
    }
  }, [options])
}
