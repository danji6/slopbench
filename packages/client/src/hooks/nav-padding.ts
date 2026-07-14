import { useBreakpoint } from './breakpoint'

export function useNavPadding() {
  return getNavPaddingPx(useBreakpoint('lg') ? 5 : 2)
}

export function getNavPaddingPx(topPadding: number): number {
  const spacingPx =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--spacing'),
    ) * 16 || 4
  return topPadding * spacingPx
}
