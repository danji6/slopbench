export type Area = {
  width: number
  height: number
  x: number
  y: number
}

export type Point = {
  x: number
  y: number
}

export type Size = {
  width: number
  height: number
}

export type MediaSize = {
  naturalWidth: number
  naturalHeight: number
} & Size

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function roundDecimals(value: number, precision: number): number {
  const mult = 10 ** (precision || 0)
  return Math.round(value * mult) / mult
}

export function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}
