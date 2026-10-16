import { CodeEditor } from '@/components/ui/code-editor'
import '@/globals.css'
import { completionWord } from '@sb/core/code-completion/engine'
import type {
  Completion,
  CompletionProvider,
} from '@sb/core/code-completion/types'
import { useState } from 'react'

const symbols: Completion[] = [
  { label: 'text', kind: 'variable' },
  { label: 'message', kind: 'variable' },
  {
    label: 'replace',
    kind: 'function',
    snippet: 'replace($0)',
    params: [
      {
        name: 'scope',
        values: ['selection', 'paragraph', 'message', 'toEnd', 'toStart'],
      },
      { name: 'value', optional: true, description: 'Replacement text' },
    ],
  },
  {
    label: 'wrap',
    kind: 'function',
    snippet: 'wrap(${1:text}, ${2:message})$0',
    params: [{ name: 'first' }, { name: 'second' }],
  },
]

const slowProvider: CompletionProvider = async (request) => {
  const word = completionWord(request)
  if (!word.query) return { items: [] }
  await new Promise((resolve) =>
    setTimeout(resolve, word.query === 'old' ? 500 : 10),
  )
  return {
    items: [{ label: `${word.query}Result`, from: word.from, to: word.to }],
  }
}

export function CodeCompletionFixture() {
  const [source, setSource] = useState('')
  const [other, setOther] = useState('')
  const [language, setLanguage] = useState('javascript')
  const [slow, setSlow] = useState(false)
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <label>
        Source
        <textarea
          aria-label="Source"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      <label>
        Language
        <select
          aria-label="Language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          <option value="javascript">JavaScript</option>
          <option value="css">CSS</option>
          <option value="json">JSON</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={slow}
          onChange={(event) => setSlow(event.target.checked)}
        />
        Delayed provider
      </label>
      <div data-testid="primary-editor">
        <CodeEditor
          value={source}
          onChange={setSource}
          language={language}
          completions={
            slow
              ? slowProvider
              : language === 'javascript'
                ? symbols
                : undefined
          }
          fullscreenId="completion-primary"
          className="h-40"
        />
      </div>
      <output aria-label="Saved code">{source}</output>
      <div data-testid="other-editor">
        <CodeEditor
          value={other}
          onChange={setOther}
          completions={symbols}
          fullscreenId="completion-other"
          className="h-32"
        />
      </div>
      <button>Outside editor</button>
    </main>
  )
}
