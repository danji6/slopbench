const HEADER_LINE = 24
const AVATAR_CENTER = 28
const AVATAR_GAP = 16

/** Minimum avatar size. */
export const AVATAR_MIN = 32
/**
 * Maximum avatar size. Kept at most twice AVATAR_CENTER or it would leak onto
 * the message above.
 */
export const AVATAR_MAX = AVATAR_CENTER * 2

/** Minimum space required for the gutter to appear. */
const GUTTER_HEADROOM = '4rem'

const clampSize = (size: number) =>
  Math.min(AVATAR_MAX, Math.max(AVATAR_MIN, Math.round(size / 2) * 2))

const gutterFor = (size: number) => clampSize(size) + AVATAR_GAP

/** Width of the message column. */
export const columnWidth = (chatWidth: number, unit: '%' | 'cqw') =>
  `calc(min(95${unit}, ${chatWidth}px - var(--spacing)*36) - var(--spacing)*6)`

/** The gutter takes the leftover width beside the message column. */
export const avatarGutter = (chatWidth: number, size: number) =>
  `clamp(0px, ((100cqw - ${columnWidth(chatWidth, 'cqw')}) / 2 - ${GUTTER_HEADROOM}) * 1000, ${gutterFor(size)}px)`

/** The avatar's size and offsets as ratios of the gutter. */
export const avatarVars = (size: number) => {
  const px = clampSize(size)
  const gutter = gutterFor(px)
  return {
    '--avatar-size': `${px}px`,
    '--avatar-lift': `${(px - HEADER_LINE) / gutter}`,
    '--avatar-drop': `${(AVATAR_CENTER - px / 2) / gutter}`,
  }
}
