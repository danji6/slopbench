export type ScrollOperationKind = 'follow' | 'restore' | 'navigate'

export type ScrollOperation = {
  readonly kind: ScrollOperationKind
  isCurrent(): boolean
  onCancel(cleanup: () => void): void
  finish(): void
}

const priority: Record<ScrollOperationKind, number> = {
  follow: 0,
  restore: 1,
  navigate: 2,
}

/** Arbitrates viewport ownership and invalidates asynchronous work on interruption. */
export class ScrollCoordinator {
  private active: ScrollOperation | null = null
  private cleanups: Array<() => void> = []
  private editing = false
  private followAllowed = true
  private revision = 0

  get kind() {
    return this.active?.kind ?? null
  }

  begin(kind: ScrollOperationKind): ScrollOperation | null {
    if (kind === 'follow' && !this.canFollow()) return null
    if (this.active && priority[kind] < priority[this.active.kind]) return null
    this.cancel()
    const operation: ScrollOperation = {
      kind,
      isCurrent: () => this.active === operation,
      onCancel: (cleanup) => {
        if (this.active === operation) this.cleanups.push(cleanup)
        else cleanup()
      },
      finish: () => {
        if (this.active === operation) {
          this.active = null
          this.cleanups = []
        }
      },
    }
    this.active = operation
    return operation
  }

  setEditing(editing: boolean) {
    this.editing = editing
    if (editing && this.active?.kind === 'follow') this.cancel()
  }

  canFollow() {
    return (
      this.followAllowed &&
      !this.editing &&
      (this.active === null || this.active.kind === 'follow')
    )
  }

  resumeFollow() {
    this.followAllowed = true
  }

  interrupt() {
    this.followAllowed = false
    this.cancel()
  }

  /** Guards layout compensation without creating another navigation operation. */
  checkpoint(): () => boolean {
    const revision = this.revision
    return () => revision === this.revision
  }

  /** Cancels the current operation before running its cleanup callbacks. */
  cancel() {
    this.revision++
    const cleanups = this.cleanups
    this.active = null
    this.cleanups = []
    for (const cleanup of cleanups) cleanup()
  }
}
