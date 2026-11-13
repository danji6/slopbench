import { exportSchemeCss, schemeProperties } from '@cv/client/lib/theme'
import { camelToDashCase } from '@cv/core/utils/strings'
import { readFileSync, writeFileSync } from 'node:fs'

const stylesheet = new URL(
  '../packages/client/src/styles/theme.css',
  import.meta.url,
)
const defaults = new URL(
  '../packages/convex/src/model/defaults.ts',
  import.meta.url,
)

function replacePalette(css: string, color: string, mode: 'light' | 'dark') {
  const start = `  /* Begin generated ${mode} palette */`
  const end = `  /* End generated ${mode} palette */`
  const sections = css.split(start)
  const block = sections.length === 2 ? sections[1].split(end) : []
  if (block.length !== 2) {
    throw new Error(`Expected one generated ${mode} palette in theme.css`)
  }

  const { css: palette } = exportSchemeCss(color, mode === 'dark', 0)
  const declarations = schemeProperties.map((property) => {
    const token = `--${camelToDashCase(property)}`
    const value = palette[token]
    if (!value) throw new Error(`Theme generator did not export ${token}`)
    return `  ${token}: ${value};`
  })

  return `${sections[0]}${start}\n${declarations.join('\n')}\n${end}${block[1]}`
}

function main() {
  const input = process.argv[2]?.trim()
  if (process.argv.length !== 3 || !input || !/^#?[0-9a-f]{6}$/i.test(input)) {
    throw new Error(`Usage: bun run gen:theme '#30275E' (six-digit hex color)`)
  }

  const color = `#${input.replace(/^#/, '').toLowerCase()}`
  const css = readFileSync(stylesheet, 'utf8')
  const source = readFileSync(defaults, 'utf8')
  const sourceDeclaration = /^export const SOURCE_COLOR = '#[0-9a-f]{6}'$/gim
  if ([...source.matchAll(sourceDeclaration)].length !== 1) {
    throw new Error('Expected one SOURCE_COLOR declaration in defaults.ts')
  }

  const lightCss = replacePalette(css, color, 'light')
  const updatedCss = replacePalette(lightCss, color, 'dark')
  const updatedSource = source.replace(
    sourceDeclaration,
    `export const SOURCE_COLOR = '${color}'`,
  )

  if (updatedCss !== css) writeFileSync(stylesheet, updatedCss)
  if (updatedSource !== source) writeFileSync(defaults, updatedSource)

  console.log(`Default light and dark themes generated from ${color}.`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
