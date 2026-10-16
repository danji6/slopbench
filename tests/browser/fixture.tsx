import { usePromptPreviews } from '@/hooks/chat/prompt-previews'
import { Suspense, lazy, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { CheckboxFixture } from './checkbox-fixture'
import { ScrollFixture } from './scroll-fixture'

const InlineSourceFixture = lazy(() =>
  import('./inline-source-fixture').then((module) => ({
    default: module.InlineSourceFixture,
  })),
)

const SkillsFixture = lazy(() =>
  import('./skills-fixture').then((module) => ({
    default: module.SkillsFixture,
  })),
)

const SkillToolsFixture = lazy(() =>
  import('./skill-tools-fixture').then((module) => ({
    default: module.SkillToolsFixture,
  })),
)

const SessionFoldersFixture = lazy(() =>
  import('./session-folders-fixture').then((module) => ({
    default: module.SessionFoldersFixture,
  })),
)

const AccountSecurityFixture = lazy(() =>
  import('./account-security-fixture').then((module) => ({
    default: module.AccountSecurityFixture,
  })),
)

function PreviewFixture() {
  const [source, setSource] = useState('{{ user }}')
  const [clicks, setClicks] = useState(0)
  const [modelId, setModelId] = useState('model-a')
  const texts = useMemo(() => [source], [source])
  const context = useMemo(
    () => ({
      user: 'Fixture user',
      modelId,
      modelName: modelId === 'model-a' ? 'Model A' : 'Model B',
    }),
    [modelId],
  )
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
      <select
        aria-label="Model"
        value={modelId}
        onChange={(event) => setModelId(event.target.value)}
      >
        <option value="model-a">Model A</option>
        <option value="model-b">Model B</option>
      </select>
      <output aria-label="Preview">{preview}</output>
      <button onClick={() => setClicks((value) => value + 1)}>
        Respond {clicks}
      </button>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  new URLSearchParams(location.search).get('fixture') === 'inline-source' ? (
    <Suspense fallback={<p>Loading editor…</p>}>
      <InlineSourceFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') ===
    'account-security' ? (
    <Suspense fallback={<p>Loading account settings…</p>}>
      <AccountSecurityFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') ===
    'session-folders' ? (
    <Suspense fallback={<p>Loading session folders…</p>}>
      <SessionFoldersFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') === 'skill-tools' ? (
    <Suspense fallback={<p>Loading tool fixture…</p>}>
      <SkillToolsFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') === 'skills' ? (
    <Suspense fallback={<p>Loading skills fixture…</p>}>
      <SkillsFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') === 'checkbox' ? (
    <CheckboxFixture />
  ) : new URLSearchParams(location.search).get('fixture') === 'scroll' ? (
    <ScrollFixture />
  ) : (
    <PreviewFixture />
  ),
)
