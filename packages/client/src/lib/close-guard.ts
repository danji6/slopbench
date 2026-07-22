/**
 * Asks the browser to confirm before unloading the page, guarding against
 * accidental closes.
 *
 * @returns {() => void} Removes the guard.
 */
export function installCloseGuard(): () => void {
  const guard = (event: BeforeUnloadEvent) => {
    event.preventDefault()
  }

  window.addEventListener('beforeunload', guard)

  return () => window.removeEventListener('beforeunload', guard)
}
