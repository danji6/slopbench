/** Max characters of inlined text content for a snapshot or text attachment. */
export const MAX_TEXT_SNAPSHOT_CHARS = 50_000

const TEXT_FILE_EXTENSIONS = new Set([
  'astro',
  'bash',
  'bat',
  'c',
  'cc',
  'cfg',
  'cjs',
  'cljs',
  'clj',
  'cmake',
  'cmd',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'cxx',
  'dart',
  'diff',
  'dockerfile',
  'editorconfig',
  'env',
  'erl',
  'ex',
  'exs',
  'fish',
  'gitattributes',
  'gitignore',
  'go',
  'gql',
  'gradle',
  'graphql',
  'groovy',
  'h',
  'hpp',
  'hs',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'json5',
  'jsonc',
  'jsx',
  'kt',
  'kts',
  'less',
  'lock',
  'log',
  'lua',
  'm',
  'makefile',
  'markdown',
  'md',
  'mdx',
  'mjs',
  'mm',
  'patch',
  'php',
  'pl',
  'pm',
  'properties',
  'proto',
  'ps1',
  'py',
  'r',
  'rb',
  'rs',
  'rst',
  'sass',
  'scala',
  'scss',
  'sh',
  'sql',
  'svelte',
  'svg',
  'swift',
  'text',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
])

const TEXT_FILE_NAMES = new Set([
  '.editorconfig',
  '.env',
  '.gitattributes',
  '.gitignore',
  'cmakelists.txt',
  'dockerfile',
  'makefile',
])

const TEXT_MEDIA_TYPES = new Set([
  'application/ecmascript',
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/manifest+json',
  'application/sql',
  'application/toml',
  'application/typescript',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-yaml',
  'application/xml',
  'application/yaml',
  'image/svg+xml',
])

const BINARY_MEDIA_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  webp: 'image/webp',
}

export function detectWorkspaceMediaType(path: string): string {
  const extension = extensionFromPath(path)
  if (BINARY_MEDIA_TYPES[extension]) return BINARY_MEDIA_TYPES[extension]
  if (isTextFilename(path)) return 'text/plain'
  return 'application/octet-stream'
}

export function isKnownTextFile(
  mediaType: string | undefined,
  filename: string,
): boolean {
  return isKnownTextMediaType(mediaType) || isTextFilename(filename)
}

export function isKnownTextMediaType(mediaType: string | undefined): boolean {
  const type = mediaType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (type.startsWith('text/')) return true
  if (TEXT_MEDIA_TYPES.has(type)) return true
  return type.endsWith('+json') || type.endsWith('+xml')
}

export function isTextFilename(filename: string): boolean {
  const base = baseName(filename)
  if (!base) return false
  if (TEXT_FILE_NAMES.has(base)) return true
  if (base.startsWith('.env.')) return true
  return TEXT_FILE_EXTENSIONS.has(extensionFromBaseName(base))
}

function extensionFromPath(path: string): string {
  return extensionFromBaseName(baseName(path))
}

function extensionFromBaseName(base: string): string {
  return base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base
}

function baseName(path: string): string {
  return path.trim().toLowerCase().split(/[\\/]/).filter(Boolean).pop() ?? ''
}
