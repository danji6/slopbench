#!/usr/bin/env node
/**
 * Generates packages/client/public/assets/misc/icons-data.json.
 *
 * SVG content is read directly from the installed lucide-react package
 * (handles aliases automatically). Metadata (tags, categories) is fetched
 * from GitHub for icons that have it.
 *
 * Usage: node scripts/generate-icons-data.mjs
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..')
const iconsDir = join(root, 'node_modules/lucide-react/dist/esm/icons')

const { version } = JSON.parse(
  readFileSync(join(root, 'node_modules/lucide-react/package.json'), 'utf8'),
)
console.log(`lucide-react version: ${version}`)

const importsFile = readFileSync(
  join(root, 'node_modules/lucide-react/dist/esm/dynamicIconImports.js'),
  'utf8',
)
const names = [...importsFile.matchAll(/"([\w-]+)":\s*\(\)/g)].map((m) => m[1])
console.log(`Found ${names.length} icons`)

// --- SVG from package (sync, handles aliases) ---

function readIconSvg(name, visited = new Set()) {
  if (visited.has(name)) return ''
  visited.add(name)

  let content
  try {
    content = readFileSync(join(iconsDir, `${name}.js`), 'utf8')
  } catch {
    return ''
  }

  const alias = content.match(/export \{ default \} from '\.\/(.+?)\.js'/)
  if (alias) return readIconSvg(alias[1], visited)

  const nodeMatch = content.match(/const __iconNode = (\[[\s\S]*?\]);/)
  if (!nodeMatch) return ''

  // eslint-disable-next-line no-new-func
  const nodes = Function('return ' + nodeMatch[1])()

  return nodes
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ')
      return `<${tag} ${attrStr}/>`
    })
    .join('')
}

// --- Metadata from GitHub (async, best-effort) ---

const BASE = `https://raw.githubusercontent.com/lucide-icons/lucide/${version}/icons`
const CONCURRENCY = 30

async function fetchMeta(name) {
  try {
    const res = await fetch(`${BASE}/${name}.json`)
    if (!res.ok) return { categories: [], tags: [] }
    const { categories = [], tags = [] } = await res.json()
    return { categories, tags }
  } catch {
    return { categories: [], tags: [] }
  }
}

const metaMap = new Map()
for (let i = 0; i < names.length; i += CONCURRENCY) {
  const batch = names.slice(i, i + CONCURRENCY)
  const results = await Promise.all(
    batch.map(async (name) => [name, await fetchMeta(name)]),
  )
  for (const [name, meta] of results) metaMap.set(name, meta)
  process.stdout.write(
    `\r  ${Math.min(i + CONCURRENCY, names.length)}/${names.length}`,
  )
}
console.log()

// --- Assemble and write ---

const output = names
  .map((name) => {
    const svgContent = readIconSvg(name)
    const { categories, tags } = metaMap.get(name) ?? {
      categories: [],
      tags: [],
    }
    return { name, categories, tags, svgContent }
  })
  .filter((icon) => icon.svgContent) // drop any that still have no SVG

const outPath = join(
  root,
  'packages',
  'client',
  'public',
  'assets',
  'misc',
  'icons-data.json',
)
writeFileSync(outPath, JSON.stringify(output))
console.log(
  `Wrote ${output.length} entries → packages/client/public/assets/misc/icons-data.json`,
)
