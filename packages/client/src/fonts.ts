const SYSTEM_FONT =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

const WEB_SAFE: Record<string, string> = {
  Arial: 'Arial, sans-serif',
  Calibri: 'Calibri, sans-serif',
  'DejaVu Sans': '"DejaVu Sans", sans-serif',
  'DejaVu Serif': '"DejaVu Serif", serif',
  Helvetica: 'Helvetica, Arial, sans-serif',
  'Segoe UI': '"Segoe UI", sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
}

const WEB_SAFE_MONO: Record<string, string> = {
  Consolas: 'Consolas, monospace',
  'Courier New': '"Courier New", monospace',
  'DejaVu Sans Mono': '"DejaVu Sans Mono", monospace',
  Menlo: 'Menlo, monospace',
}

const MONO_NAME = /\b(mono|code|consol|courier|typewriter|terminal)\b/i

const WEIGHT_KEYWORDS: [name: string, weight: number][] = [
  ['hairline', 100],
  ['thin', 100],
  ['extralight', 200],
  ['ultralight', 200],
  ['semilight', 350],
  ['demilight', 350],
  ['light', 300],
  ['regular', 400],
  ['normal', 400],
  ['book', 400],
  ['medium', 500],
  ['semibold', 600],
  ['demibold', 600],
  ['extrabold', 800],
  ['ultrabold', 800],
  ['bold', 700],
  ['black', 900],
  ['heavy', 900],
]

const VARIABLE_RANGE = '100 900'

type FontFace = { url: string; weight: string; style: 'normal' | 'italic' }

/* Autodiscovered fonts: drop files into `src/assets/fonts`.
 * Filenames follow "<Family>-<descriptor>.<ext>". */
const FONT_MODULES = import.meta.glob(
  '../assets/fonts/**/*.{woff2,woff,ttf,otf}',
  {
    eager: true,
    query: '?url',
    import: 'default',
  },
) as Record<string, string>

function readDescriptor(descriptor: string): Omit<FontFace, 'url'> {
  const collapsed = descriptor.toLowerCase().replace(/[^a-z0-9]/g, '')
  const style: FontFace['style'] = /italic|oblique/.test(collapsed)
    ? 'italic'
    : 'normal'

  if (/variable|wght/.test(collapsed)) return { weight: VARIABLE_RANGE, style }

  const numeric = collapsed.match(/[1-9]\d{2}/)
  if (numeric) return { weight: numeric[0], style }

  for (const [name, weight] of WEIGHT_KEYWORDS) {
    if (collapsed.includes(name)) return { weight: String(weight), style }
  }
  return { weight: '400', style }
}

function parseFace(filePath: string, url: string) {
  const rel = filePath.split('/assets/fonts/').pop()!
  const segments = rel.split('/')
  const fileName = segments.pop()!.replace(/\.(woff2?|ttf|otf)$/i, '')
  const folder = segments.pop()

  if (folder) {
    return { family: folder, face: { url, ...readDescriptor(fileName) } }
  }

  const dash = fileName.indexOf('-')
  const family = (dash === -1 ? fileName : fileName.slice(0, dash)).trim()
  const descriptor = dash === -1 ? '' : fileName.slice(dash + 1)

  return { family, face: { url, ...readDescriptor(descriptor) } }
}

const discovered = new Map<string, FontFace[]>()
for (const [filePath, url] of Object.entries(FONT_MODULES)) {
  const { family, face } = parseFace(filePath, url)
  const faces = discovered.get(family) ?? []
  faces.push(face)
  discovered.set(family, faces)
}

const sorted = (names: Iterable<string>) =>
  [...new Set(names)].sort((a, b) => a.localeCompare(b))

const discoveredMono = [...discovered.keys()].filter((f) => MONO_NAME.test(f))

/** Names shown in the appearance picker */
export const FONT_NAMES: string[] = sorted([
  ...Object.keys(WEB_SAFE),
  ...Object.keys(WEB_SAFE_MONO),
  ...discovered.keys(),
])
export const MONO_FONT_NAMES: string[] = sorted([
  ...Object.keys(WEB_SAFE_MONO),
  ...discoveredMono,
])

function faceRule(family: string, face: FontFace): string {
  return [
    '@font-face {',
    `  font-family: ${JSON.stringify(family)};`,
    `  src: url(${JSON.stringify(face.url)});`,
    `  font-weight: ${face.weight};`,
    `  font-style: ${face.style};`,
    '  font-display: swap;',
    '}',
  ].join('\n')
}

let installed = false

/** Injects @font-face rules for every discovered font */
export function installFonts(): void {
  if (installed || typeof document === 'undefined' || discovered.size === 0)
    return
  installed = true
  const css = [...discovered.entries()]
    .flatMap(([family, faces]) => faces.map((face) => faceRule(family, face)))
    .join('\n')
  const style = document.createElement('style')
  style.dataset.fonts = 'discovered'
  style.textContent = css
  document.head.appendChild(style)
}

export function getFontFamily(font: string): string {
  if (!font || font === 'system') return SYSTEM_FONT
  if (WEB_SAFE[font]) return WEB_SAFE[font]
  if (WEB_SAFE_MONO[font]) return WEB_SAFE_MONO[font]
  if (discovered.has(font)) return `${JSON.stringify(font)}, sans-serif`
  return font
}

export function getMonoFontFamily(font: string): string {
  if (!font || font === 'system') return SYSTEM_MONO
  if (WEB_SAFE_MONO[font]) return WEB_SAFE_MONO[font]
  return `${JSON.stringify(font)}, ${SYSTEM_MONO}`
}
