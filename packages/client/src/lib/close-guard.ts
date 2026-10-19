/**
 * Asks the browser to confirm before unloading while work needs protection.
 *
 * @returns {() => void} Removes the guard.
 */
export function installCloseGuard(shouldGuard: () => boolean): () => void {
  const guard = (event: BeforeUnloadEvent) => {
    if (!shouldGuard()) return
    event.preventDefault()
  }

  window.addEventListener('beforeunload', guard)

  return () => window.removeEventListener('beforeunload', guard)
}
