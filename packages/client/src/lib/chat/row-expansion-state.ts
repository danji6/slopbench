export const ROW_TRANSITION_MS = 200
export const MAX_COLLAPSED_ROW_HEIGHT = 1
export type RowTransition = {
  phase: 'preparing' | 'opening' | 'closing'
  mountedRows: ReadonlySet<string>
}

/** Stores group expansion independently of mounted transcript rows. */
export function createRowExpansionStore() {
  let open = new Set<string>()
  let transitions = new Map<string, RowTransition>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<() => void>()

  const notify = () => listeners.forEach((listener) => listener())

  const finishTransition = (id: string, expected: RowTransition) => {
    if (transitions.get(id) !== expected) return
    transitions = new Map(transitions)
    transitions.delete(id)
    timers.delete(id)
    notify()
  }

  const finishOpeningLater = (id: string, transition: RowTransition) => {
    timers.set(
      id,
      setTimeout(
        () => finishTransition(id, transition),
        ROW_TRANSITION_MS + 32,
      ),
    )
  }

  return {
    getSnapshot: () => open as ReadonlySet<string>,
    getTransitions: () => transitions as ReadonlyMap<string, RowTransition>,
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

      const animate = mountedRows && (value || mountedRows.size > 0)
      if (animate && previousPhase !== 'preparing') {
        const phase = value
          ? previousPhase === 'closing'
            ? 'opening'
            : 'preparing'
          : 'closing'
        const transition: RowTransition = { phase, mountedRows }
        transitions.set(id, transition)
        if (phase === 'opening') finishOpeningLater(id, transition)
      }

      notify()
    },
    /** Starts the reveal after visible children have mounted and been measured. */
    startOpening(id: string, expected: RowTransition) {
      if (transitions.get(id) !== expected || expected.phase !== 'preparing')
        return
      const transition: RowTransition = { ...expected, phase: 'opening' }
      transitions = new Map(transitions)
      transitions.set(id, transition)
      finishOpeningLater(id, transition)
      notify()
    },
    /** Removes closing rows once their animation and measurement have settled. */
    finishClosing(id: string, expected: RowTransition) {
      if (expected.phase === 'closing') finishTransition(id, expected)
    },
  }
}
