import type { ScrollCoordinator } from './scroll-coordinator'

export interface AutoScrollerOptions {
  coordinator?: ScrollCoordinator
  enabled?: boolean

  /** Time to ease through the remaining distance. Lower = snappier. */
  followTimeConstantMs?: number

  /**
   * Upper bound on follow velocity. Caps a frame scroll step so
   * that large gaps glide smoothly instead of snapping to the bottom.
   */
  maxFollowSpeedPxPerMs?: number

  /**
   * Invoked when the stop condition is met.
   */
  onSettle?: () => void

  /**
   * Invoked when the user scrolls up while auto-following is active.
   */
  onFollowRelease?: () => void

  /** Invoked when content growth may have changed the bottom distance. */
  onPositionChange?: (autoScrolling: boolean) => void

  /**
   * Distance (px) reserved at the bottom of the viewport to prevent
   * early locking.
   */
  bottomInset?: number
}
