import type { Editor } from '@tiptap/react'

/**
 * The part of the document a script wants to change.
 * `toEnd`/`toStart` span between the selection and either end.
 */
type Scope = 'selection' | 'paragraph' | 'message' | 'toEnd' | 'toStart'

/** A targeted edit produced by a script's helper functions. */
class ScriptOp {
  constructor(
    readonly scope: Scope,
    readonly value: string,
  ) {}
}

type Range = { from: number; to: number }

/** Helpers exposed to user scripts for editing beyond the selection. */
const SCRIPT_HELPERS = {
  replaceSelection: (value: string) => new ScriptOp('selection', String(value)),
  replaceParagraph: (value: string) => new ScriptOp('paragraph', String(value)),
  replaceMessage: (value: string) => new ScriptOp('message', String(value)),
  replaceToEnd: (value: string) => new ScriptOp('toEnd', String(value)),
  replaceToStart: (value: string) => new ScriptOp('toStart', String(value)),
  deleteSelection: () => new ScriptOp('selection', ''),
  deleteParagraph: () => new ScriptOp('paragraph', ''),
  deleteMessage: () => new ScriptOp('message', ''),
  deleteToEnd: () => new ScriptOp('toEnd', ''),
  deleteToStart: () => new ScriptOp('toStart', ''),
}

const HELPER_NAMES = Object.keys(SCRIPT_HELPERS) as Array<
  keyof typeof SCRIPT_HELPERS
>

/** Helper functions a script may return, in declaration order. */
export const SCRIPT_HELPER_NAMES: readonly string[] = HELPER_NAMES

/** Variables made available to every script. */
export const SCRIPT_VARIABLES = [
  'text',
  'paragraph',
  'message',
  'editor',
] as const

/** Runs a user script on the editor selection. */
export function applyScript(editor: Editor, scriptCode: string) {
  const plain = editor.isActive('codeBlock')
  const context = {
    text: rangeText(editor, scopeRange(editor, 'selection'), plain),
    paragraph: rangeText(editor, scopeRange(editor, 'paragraph'), plain),
    message: rangeText(editor, scopeRange(editor, 'message'), plain),
    editor,
  }

  const op = executeScript(scriptCode, context)
  if (!op) return

  const range = scopeRange(editor, op.scope)
  if (plain) replacePlain(editor, range, op.value)
  else replaceMarkdown(editor, range, op.value, op.scope)
}

type ScriptContext = {
  text: string
  paragraph: string
  message: string
  editor: Editor
}

function executeScript(
  code: string,
  context: ScriptContext,
): ScriptOp | undefined {
  try {
    const fn = new Function(
      'text',
      'paragraph',
      'message',
      'editor',
      ...HELPER_NAMES,
      code,
    )
    const result = fn(
      context.text,
      context.paragraph,
      context.message,
      context.editor,
      ...HELPER_NAMES.map((name) => SCRIPT_HELPERS[name]),
    )
    if (result instanceof ScriptOp) return result
    if (typeof result === 'string') return new ScriptOp('selection', result)
    return undefined
  } catch (error) {
    console.error('[script] runtime error', error)
    return undefined
  }
}

/** Maps a scope to a document position range, relative to the selection. */
function scopeRange(editor: Editor, scope: Scope): Range {
  const { doc, selection } = editor.state
  const { from, to } = selection
  const end = doc.content.size

  switch (scope) {
    case 'selection':
      return { from, to }
    case 'message':
      return { from: 0, to: end }
    case 'toEnd':
      return { from, to: end }
    case 'toStart':
      return { from: 0, to }
    case 'paragraph': {
      const block = doc.resolve(from).blockRange(doc.resolve(to))
      return block ? { from: block.start, to: block.end } : { from, to }
    }
  }
}

function rangeText(editor: Editor, range: Range, plain: boolean): string {
  if (plain) return editor.state.doc.textBetween(range.from, range.to, '\n')
  const content = editor.state.doc.slice(range.from, range.to).content.toJSON()
  return markdownManager(editor).serialize({ type: 'doc', content }).trim()
}

function replacePlain(editor: Editor, range: Range, value: string) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      if (value === '') tr.delete(range.from, range.to)
      else tr.insertText(value, range.from, range.to)
      return true
    })
    .run()
}

function replaceMarkdown(
  editor: Editor,
  range: Range,
  value: string,
  scope: Scope,
) {
  const manager = markdownManager(editor)
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      if (value === '') {
        tr.delete(range.from, range.to)
      } else {
        const nodes = nodesFromMarkdown(manager, value, scope).map((node) =>
          state.schema.nodeFromJSON(node),
        )
        tr.replaceWith(range.from, range.to, nodes)
      }
      // Keep at least one block so the document stays schema-valid.
      if (tr.doc.content.size === 0) {
        tr.insert(0, state.schema.nodes.paragraph.create())
      }
      return true
    })
    .run()
}

/** Parses markdown into nodes to insert. */
function nodesFromMarkdown(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manager: any,
  value: string,
  scope: Scope,
): Array<{ type: string; content?: unknown[] }> {
  const parsed = manager.parse(value) as {
    type: 'doc'
    content: Array<{ type: string; content?: unknown[] }>
  }

  const inlineOnly =
    scope === 'selection' &&
    parsed.content.length === 1 &&
    parsed.content[0].type === 'paragraph' &&
    parsed.content[0].content

  return inlineOnly
    ? (parsed.content[0].content as Array<{
        type: string
        content?: unknown[]
      }>)
    : parsed.content
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function markdownManager(editor: Editor): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage.markdown as any).manager
}
