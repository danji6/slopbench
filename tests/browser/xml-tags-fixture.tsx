import { ComposerEditor } from '@/components/chat/composer/composer-editor'
import { CodeEditor } from '@/components/ui/code-editor'
import '@/globals.css'
import { serializeDocumentToMarkdown } from '@/lib/tiptap/serialize'
import { useState } from 'react'

/** Exercises native XML input in the production composer and code editor. */
export function XmlTagsFixture() {
  const [code, setCode] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [invertSend, setInvertSend] = useState(false)
  const [sends, setSends] = useState(0)
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <label>
        <input
          type="checkbox"
          checked={invertSend}
          onChange={(event) => setInvertSend(event.target.checked)}
        />
        Send with Shift+Enter
      </label>
      <div data-testid="composer">
        <ComposerEditor
          autoFocus={false}
          onReady={(editor) => {
            editor.on('update', ({ editor: current }) => {
              setMarkdown(serializeDocumentToMarkdown(current))
            })
          }}
          handleKeyDown={(_view, event) => {
            if (event.key !== 'Enter') return false
            const modifiedSend = event.ctrlKey || event.metaKey
            const sendChord = invertSend ? event.shiftKey : !event.shiftKey
            if (!modifiedSend && !sendChord) return false
            setSends((count) => count + 1)
            return true
          }}
        />
      </div>
      <output aria-label="Saved markdown">{markdown}</output>
      <output aria-label="Sends">{sends}</output>
      <div data-testid="code">
        <CodeEditor
          value={code}
          onChange={setCode}
          fullscreenId="xml-code"
          className="h-40"
        />
      </div>
      <output aria-label="Saved code">{code}</output>
    </main>
  )
}
