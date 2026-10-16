import '@/globals.css'
import { editorKit } from '@/lib/tiptap/kit'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'

export type SourceFixtureWindow = Window & { sourceFixtureEditor?: Editor }
const INITIAL = 'before **bold *nested* text** after and ~~other~~'

/** Exercises the production Markdown kit using native browser editing. */
export function InlineSourceFixture() {
  const [markdown, setMarkdown] = useState(INITIAL)
  const [updates, setUpdates] = useState(0)
  const editor = useEditor({
    extensions: editorKit({ math: 'single', tables: true }),
    content: INITIAL,
    contentType: 'markdown',
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': 'Markdown editor' },
    },
    onUpdate({ editor: current }) {
      setMarkdown(serializeDocumentToMarkdown(current))
      setUpdates((count) => count + 1)
    },
  })
  useEffect(() => {
    const fixtureWindow = window as SourceFixtureWindow
    if (editor) fixtureWindow.sourceFixtureEditor = editor
    return () => {
      delete fixtureWindow.sourceFixtureEditor
    }
  }, [editor])
  return (
    <main style={{ padding: 40, maxWidth: 900 }}>
      <EditorContent editor={editor} />
      <button type="button">Outside editor</button>
      <output aria-label="Saved markdown">{markdown}</output>
      <output aria-label="Content updates">{updates}</output>
    </main>
  )
}
