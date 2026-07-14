export const toDashCase = (text: string): string =>
  text.replace(/\s/g, '-').toLowerCase()

export const toSnakeCase = (text: string): string =>
  text.replace(/\s/g, '_').toLowerCase()

export const camelToDashCase = (text: string): string =>
  text.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export const dashToCamelCase = (text: string): string =>
  text.replace(/-\w/g, (s) => s.substring(1).toUpperCase())

export const capitalize = (text: string): string =>
  text.substring(0, 1).toUpperCase() + text.substring(1)

export function dedent(
  strings: TemplateStringsArray,
  ...values: unknown[]
): string {
  const raw = String.raw({ raw: strings }, ...values)
  const lines = raw.split('\n')
  const trimmed = lines[0] === '' ? lines.slice(1) : lines
  const lastLine = trimmed[trimmed.length - 1]
  if (lastLine !== undefined && /^\s*$/.test(lastLine)) trimmed.pop()
  const indent = Math.min(
    ...trimmed.filter((l) => l.trim()).map((l) => l.match(/^(\s*)/)![1].length),
  )
  return trimmed.map((l) => l.slice(indent)).join('\n')
}

export function inline(strings: TemplateStringsArray, ...values: unknown[]) {
  return String.raw({ raw: strings }, ...values)
    .replace(/\s+/g, ' ')
    .trim()
}

export function truncateToExtension(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }

  const extension = str.split('.').pop() || ''
  return `${str.slice(0, maxLength - extension.length - 1)}(...).${extension}`
}
