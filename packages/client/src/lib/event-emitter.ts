type EventHandler<T> = (data: T) => void

export class TypedEventEmitter<TMap extends Record<string, unknown>> {
  private _listeners = new Map<keyof TMap, Set<EventHandler<unknown>>>()

  on<K extends keyof TMap>(
    event: K,
    handler: EventHandler<TMap[K]>,
  ): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set())
    }
    this._listeners.get(event)?.add(handler as EventHandler<unknown>)
    return () =>
      this._listeners.get(event)?.delete(handler as EventHandler<unknown>)
  }

  emit<K extends keyof TMap>(event: K, data: TMap[K]): void {
    this._listeners.get(event)?.forEach((h) => {
      try {
        const result = h(data) as unknown
        if (result instanceof Promise) {
          result.catch((err) =>
            console.error(`[TypedEventEmitter:${String(event)}]`, err),
          )
        }
      } catch (err) {
        console.error(`[TypedEventEmitter:${String(event)}]`, err)
      }
    })
  }

  dispose(): void {
    this._listeners.clear()
  }
}
