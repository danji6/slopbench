import type { ToolUIPart } from 'ai'

export type ReadFileOutput = {
  path: string
  content?: string
  totalLines?: number
  offset?: number
  truncated?: boolean
}

export type FileMutationOutput = {
  path: string
  diff?: string
  edits?: number
  bytes?: number
  checkpointId?: string
}

export type FileEdit = { oldText: string; newText: string }

function isFileEdit(value: unknown): value is FileEdit {
  if (!value || typeof value !== 'object') return false
  const edit = value as Partial<Record<keyof FileEdit, unknown>>
  return typeof edit.oldText === 'string' && typeof edit.newText === 'string'
}

export function parseFileEdits(edits: unknown): FileEdit[] | undefined {
  if (Array.isArray(edits)) {
    const parsed = edits.filter(isFileEdit)
    return parsed.length ? parsed : undefined
  }

  return isFileEdit(edits) ? [edits] : undefined
}

export function parseOutputValue<T extends object>(
  output: unknown,
): T | undefined {
  if (output && typeof output === 'object') return output as T
  if (typeof output !== 'string') return undefined

  try {
    const parsed: unknown = JSON.parse(output)
    if (parsed && typeof parsed === 'object') return parsed as T
  } catch {
    // Raw text output, e.g. tool failures
  }

  return undefined
}

export function parseToolOutput<T extends object>(
  part: ToolUIPart,
): T | undefined {
  if (part.state !== 'output-available') return undefined
  return parseOutputValue<T>(part.output)
}

export function buildEditsPreviewDiff(
  path: string | undefined,
  edits: FileEdit[],
): string {
  const sections = edits.map((edit) => {
    const removed = edit.oldText
      .split('\n')
      .map((line) => `-${line}`)
      .join('\n')
    const added = edit.newText
      .split('\n')
      .map((line) => `+${line}`)
      .join('\n')
    return `${removed}\n${added}`
  })

  const header = path ? [`--- ${path}`, `+++ ${path}`] : []
  return [...header, ...sections].join('\n')
}

const EXTENSION_LANGS: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'jsonc',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'zsh',
  fish: 'fish',
  ps1: 'powershell',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  java: 'java',
  kt: 'kotlin',
  lua: 'lua',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  php: 'php',
  swift: 'swift',
  rb: 'ruby',
  dart: 'dart',
}

export function languageFromPath(path: string | undefined): string | undefined {
  const extension = path?.split('.').pop()?.toLowerCase()
  return extension ? EXTENSION_LANGS[extension] : undefined
}
