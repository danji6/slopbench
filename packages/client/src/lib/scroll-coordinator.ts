export type ScrollOperationKind = 'follow' | 'restore' | 'navigate'

export type ScrollOperation = {
  readonly kind: ScrollOperationKind
  readonly exclusive: boolean
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
  private pendingLayouts = new Set<symbol>()

  get layoutPending() {
    return this.pendingLayouts.size > 0
  }

  /** Tracks mounted content whose initial data can still change its height. */
  trackPendingLayout = () => {
    const token = Symbol()
    this.pendingLayouts.add(token)
    return () => {
      this.pendingLayouts.delete(token)
    }
  }

  get kind() {
    return this.active?.kind ?? null
  }

  /** Reports whether the active operation blocks external scroll corrections. */
  get exclusive() {
    return this.active?.exclusive ?? false
  }

  begin(
    kind: ScrollOperationKind,
    options: { exclusive?: boolean } = {},
  ): ScrollOperation | null {
    if (kind === 'follow' && !this.canFollow()) return null
    if (this.active && priority[kind] < priority[this.active.kind]) return null
    this.cancel()
    const operation: ScrollOperation = {
      kind,
      exclusive: options.exclusive ?? false,
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
