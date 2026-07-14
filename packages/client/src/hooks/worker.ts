
import { isServer } from '@/lib/utils'
import type { WorkerApi } from '@/workers'
import { useCallback, useEffect, useRef, useState } from 'react'

export type UseWorkerOptions<T> = {
  callback?: (worker: WorkerApi<T>) => Promise<void>
  runOnMount?: boolean
}

export function useWorker<T>(
  workerFn: () => WorkerApi<T>,
  { callback, runOnMount = false }: UseWorkerOptions<T>,
): [() => void, boolean] {
  const [isRunning, setRunning] = useState(false)
  const workerRef = useRef<WorkerApi<T> | undefined>(undefined)

  const run = useCallback(async () => {
    if (isRunning) return
    setRunning(true)

    try {
      const worker = workerFn()
      workerRef.current = worker
      await callback?.(worker)
    } finally {
      setRunning(false)
    }
  }, [isRunning, callback, workerFn])

  useEffect(() => {
    if (isServer) return
    if (runOnMount) requestAnimationFrame(run)

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [run, isRunning]
}
