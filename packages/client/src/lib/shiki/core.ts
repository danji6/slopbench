import flourite from 'flourite'
import {
  type Highlighter,
  type ShikiTransformer,
  createHighlighter,
} from 'shiki'

import { type ParsedDiffLine, diffGutters, parseDiffLines } from './diff'
import { theme, themeName } from './theme'

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null

const langs = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'jsonc',
  'css',
  'scss',
  'less',
  'postcss',
  'html',
  'csharp',
  'python',
  'bash',
  'sh',
  'zsh',
  'fish',
  'powershell',
  'yaml',
  'diff',
  'markdown',
  'sql',
  'xml',
  'java',
  'kotlin',
  'lua',
  'rust',
  'c',
  'cpp',
  'go',
  'php',
  'swift',
  'ruby',
  'dart',
]

const langRemap: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  cs: 'csharp',
  'c#': 'csharp',
  tw: 'less',
  tailwind: 'less',
  tailwindcss: 'less',
  yml: 'yaml',
  md: 'markdown',
  lua: 'lua',
  ps1: 'powershell',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
  go: 'go',
  php: 'php',
  swift: 'swift',
  ruby: 'ruby',
  dart: 'dart',
}

function detectLanguage(code: string): string {
  try {
    const res = flourite(code, { shiki: true })
    if (res.language === 'Unknown') return 'typescript'
    return res.language.toLowerCase()
  } catch {
    return 'typescript'
  }
}

export async function getHighlighter() {
  if (highlighter) return highlighter

  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [theme],
      langs,
    }).then((hl) => {
      highlighter = hl
      return hl
    })
  }

  return highlighterPromise
}

/** Resolve to a loaded grammar, falling back to plain text for unknown langs. */
function resolveLang(hl: Highlighter, code: string, lang?: string): string {
  const requested = (lang && langRemap[lang]) || lang || detectLanguage(code)
  return hl.getLoadedLanguages().includes(requested) ? requested : 'text'
}

export async function runHighlighter(code: string, lang?: string) {
  const hl = await getHighlighter()

  try {
    return hl.codeToHtml(code, {
      lang: resolveLang(hl, code, lang),
      theme: themeName,
      defaultColor: false,
    })
  } catch (e) {
    console.warn(e)
    return hl.codeToHtml(code, {
      lang: 'text',
      theme: themeName,
      defaultColor: false,
    })
  }
}

function diffTransformer(
  lines: ParsedDiffLine[],
  gutters: string[],
): ShikiTransformer {
  return {
    name: 'diff-lines',
    pre(node) {
      this.addClassToHast(node, 'shiki-diff')
    },
    line(node, line) {
      const info = lines[line - 1]
      if (!info) return node
      if (info.type === 'add') this.addClassToHast(node, 'diff-add')
      else if (info.type === 'remove') this.addClassToHast(node, 'diff-remove')
      else if (info.type === 'meta') this.addClassToHast(node, 'diff-meta')
      node.properties['data-gutter'] = gutters[line - 1] ?? ''
      return node
    },
  }
}

export async function runDiffHighlighter(diff: string, lang?: string) {
  const hl = await getHighlighter()

  const { code, lines, hasHunks } = parseDiffLines(diff)
  const gutters = diffGutters(lines, hasHunks)
  const render = (resolved: string) =>
    hl.codeToHtml(code, {
      lang: resolved,
      theme: themeName,
      defaultColor: false,
      transformers: [diffTransformer(lines, gutters)],
    })

  try {
    return render(resolveLang(hl, code, lang))
  } catch (e) {
    console.warn(e)
    return render('text')
  }
}
