import { usePromptPreviews } from '@/hooks/chat/prompt-previews'
import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ScrollFixture } from './scroll-fixture'

function PreviewFixture() {
  const [source, setSource] = useState('{{ user }}')
  const [clicks, setClicks] = useState(0)
  const texts = useMemo(() => [source], [source])
  const context = useMemo(() => ({ user: 'Fixture user' }), [])
  const [preview] = usePromptPreviews(texts, context)
  return (
    <main>
      <label>
        Prompt
        <textarea
          aria-label="Prompt"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </label>
      <output aria-label="Preview">{preview}</output>
      <button onClick={() => setClicks((value) => value + 1)}>
        Respond {clicks}
      </button>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).get('fixture') === 'scroll' ? (
    <ScrollFixture />
  ) : (
    <PreviewFixture />
  ),
)
