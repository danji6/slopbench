export const WORK_TRANSITION_MS = 200
export type WorkTransition = {
  phase: 'preparing' | 'opening' | 'closing'
  mountedRows: ReadonlySet<string>
}

/** Stores work expansion independently of mounted transcript rows. */
export function createWorkExpansionStore() {
  let open = new Set<string>()
  let transitions = new Map<string, WorkTransition>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<() => void>()

  const notify = () => listeners.forEach((listener) => listener())

  const finishLater = (id: string) => {
    timers.set(
      id,
      setTimeout(() => {
        transitions = new Map(transitions)
        transitions.delete(id)
        timers.delete(id)
        notify()
      }, WORK_TRANSITION_MS + 32),
    )
  }

  return {
    getSnapshot: () => open as ReadonlySet<string>,
    getTransitions: () => transitions as ReadonlyMap<string, WorkTransition>,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Animates when mounted rows are supplied; navigation can change instantly. */
    setOpen(id: string, value: boolean, mountedRows?: ReadonlySet<string>) {
      if (open.has(id) === value) return

      const previousPhase = transitions.get(id)?.phase

      clearTimeout(timers.get(id))
      timers.delete(id)
      open = new Set(open)

      if (value) open.add(id)
      else open.delete(id)

      transitions = new Map(transitions)
      transitions.delete(id)

      if (mountedRows && previousPhase !== 'preparing') {
        const phase = value
          ? previousPhase === 'closing'
            ? 'opening'
            : 'preparing'
          : 'closing'
        transitions.set(id, {
          phase,
          mountedRows,
        })
        if (phase !== 'preparing') finishLater(id)
      }

      notify()
    },
    /** Starts the reveal after visible children have mounted and been measured. */
    startOpening(id: string, expected: WorkTransition) {
      if (transitions.get(id) !== expected || expected.phase !== 'preparing')
        return
      transitions = new Map(transitions)
      transitions.set(id, { ...expected, phase: 'opening' })
      finishLater(id)
      notify()
    },
  }
}

export const workExpansion = createWorkExpansionStore()
