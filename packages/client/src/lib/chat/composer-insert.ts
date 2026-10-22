const INSERT_EVENT = 'slopbench:insert-composer-text'

/** Inserts literal text only in response to an explicit UI action. */
export function insertComposerText(text: string) {
  const event = new CustomEvent(INSERT_EVENT, {
    detail: text,
    cancelable: true,
  })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

export function listenForComposerInsertion(insert: (text: string) => boolean) {
  const listener = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== 'string')
      return
    if (event.defaultPrevented) return
    if (insert(event.detail)) event.preventDefault()
  }
  window.addEventListener(INSERT_EVENT, listener)
  return () => window.removeEventListener(INSERT_EVENT, listener)
}
