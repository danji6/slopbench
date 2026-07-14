import { CodeBlock, type CodeBlockOptions } from '@tiptap/extension-code-block'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type {
  BundledLanguage,
  Highlighter,
  SpecialLanguage,
  ThemeRegistration,
} from 'shiki'

export type CodeBlockShikiOptions = CodeBlockOptions & {
  highlighter: Highlighter | Promise<Highlighter> | null
  themes: { light: string; dark: string } | null
  customThemes: ThemeRegistration[] | null
  /** Delay between the last document change and re-highlighting while typing. */
  debounce: number
  lineNumbers: boolean
  /** Maps a code block's `language` attr to a different grammar for highlighting. */
  languageAliases: Record<string, string>
}

const shikiKey = new PluginKey<DecorationSet>('shiki')
const lineNumbersKey = new PluginKey<DecorationSet>('codeBlockLineNumbers')

const DEFAULT_DEBOUNCE_MS = 300

export const CodeBlockShiki = CodeBlock.extend<CodeBlockShikiOptions>({
  addOptions() {
    return {
      ...this.parent!(),
      highlighter: null,
      themes: null,
      customThemes: null,
      debounce: DEFAULT_DEBOUNCE_MS,
      lineNumbers: false,
      languageAliases: {},
    }
  },

  addProseMirrorPlugins() {
    const {
      highlighter: highlighterOption,
      themes,
      debounce,
      lineNumbers,
      languageAliases,
    } = this.options

    let hl: Highlighter | null = null
    Promise.resolve(highlighterOption).then((resolved) => {
      hl = resolved
    })

    function buildDecorations(doc: Node): DecorationSet {
      if (!hl) return DecorationSet.empty

      const decorations: Decoration[] = []

      doc.descendants((node, pos) => {
        if (node.type.name !== 'codeBlock') return

        const rawLang = node.attrs.language || 'plaintext'
        const lang = languageAliases[rawLang] ?? rawLang
        const loadedLangs = hl!.getLoadedLanguages()
        const resolvedLang = (
          loadedLangs.includes(lang) ? lang : 'plaintext'
        ) as BundledLanguage | SpecialLanguage
        const nodeClasses = ['shiki']
        const nodeStyle: Record<string, string> = {}

        try {
          if (themes) {
            const { tokens, bg, fg } = hl!.codeToTokens(node.textContent, {
              lang: resolvedLang,
              themes: { light: themes.light, dark: themes.dark },
            })

            if (bg) nodeStyle['background-color'] = bg
            if (fg) nodeStyle['color'] = fg

            let offset = pos + 1
            for (const line of tokens) {
              for (const token of line) {
                const from = offset
                const to = offset + token.content.length
                const style = toStyle(token.htmlStyle ?? {})
                if (style)
                  decorations.push(Decoration.inline(from, to, { style }))
                offset = to
              }
              offset += 1
            }
          } else {
            const loadedThemes = hl!.getLoadedThemes()
            const theme = loadedThemes[0]
            const { tokens } = hl!.codeToTokens(node.textContent, {
              lang: resolvedLang,
              theme,
            })

            let offset = pos + 1
            for (const line of tokens) {
              for (const token of line) {
                const from = offset
                const to = offset + token.content.length
                const style = `color:${token.color ?? 'inherit'}`
                decorations.push(Decoration.inline(from, to, { style }))
                offset = to
              }
              offset += 1
            }
          }
        } catch {
          // Ignore highlighting errors for this node
        }

        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: nodeClasses.join(' '),
            style: toStyle(nodeStyle),
          }),
        )
      })

      return DecorationSet.create(doc, decorations)
    }

    return [
      ...(lineNumbers ? [lineNumbersPlugin()] : []),
      new Plugin({
        key: shikiKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const dispatched = tr.getMeta(shikiKey) as DecorationSet | undefined
            if (dispatched !== undefined) return dispatched
            return old.map(tr.mapping, tr.doc)
          },
        },
        view: (view) => {
          let timer: ReturnType<typeof setTimeout> | null = null
          let destroyed = false

          function schedule(delay: number) {
            if (timer !== null) clearTimeout(timer)
            timer = setTimeout(() => {
              timer = null
              if (destroyed || !hl) return
              const decos = buildDecorations(view.state.doc)
              view.dispatch(view.state.tr.setMeta(shikiKey, decos))
            }, delay)
          }

          // Wait for the highlighter then yield to the event loop so the
          // browser paints before we tokenize
          Promise.resolve(highlighterOption).then(() => schedule(0))

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                schedule(debounce)
              }
            },
            destroy() {
              destroyed = true
              if (timer !== null) clearTimeout(timer)
            },
          }
        },
        props: {
          decorations: (state) => shikiKey.getState(state),
        },
      }),
    ]
  },
})

function lineNumbersPlugin(): Plugin<DecorationSet> {
  return new Plugin({
    key: lineNumbersKey,
    state: {
      init: (_, state) => buildLineNumberDecorations(state.doc),
      apply: (tr, old) => {
        if (tr.docChanged) return buildLineNumberDecorations(tr.doc)
        return old.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations: (state) => lineNumbersKey.getState(state),
    },
  })
}

function buildLineNumberDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return

    const text = node.textContent
    const lineCount = countLines(text)

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: 'tiptap-code-numbered',
        style: `--line-number-digits:${Math.max(2, String(lineCount).length)}`,
      }),
    )

    addLineNumberDecorations(decorations, pos, text)
  })

  return DecorationSet.create(doc, decorations)
}

function addLineNumberDecorations(
  decorations: Decoration[],
  nodePos: number,
  text: string,
) {
  const codeStart = nodePos + 1
  let line = 1

  decorations.push(lineNumberWidget(codeStart, line))

  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '\n') continue
    line += 1
    decorations.push(lineNumberWidget(codeStart + index + 1, line))
  }
}

function lineNumberWidget(pos: number, line: number): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const span = document.createElement('span')
      span.className = 'tiptap-code-line-number'
      span.textContent = String(line)
      span.setAttribute('aria-hidden', 'true')
      span.contentEditable = 'false'
      return span
    },
    {
      key: `line-number-${pos}-${line}`,
      side: -1,
    },
  )
}

function countLines(text: string): number {
  if (!text) return 1
  return text.split('\n').length
}

function toStyle(obj: Record<string, string>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')
}
