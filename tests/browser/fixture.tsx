import { usePromptPreviews } from '@/hooks/chat/prompt-previews'
import { Suspense, lazy, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { CheckboxFixture } from './checkbox-fixture'
import { McpCatalogFixture } from './mcp-catalog-fixture'
import { McpSettingsFixture } from './mcp-settings-fixture'
import { ProviderConnectionsFixture } from './provider-connections-fixture'
import { ScrollFixture } from './scroll-fixture'

const XmlTagsFixture = lazy(() =>
  import('./xml-tags-fixture').then((module) => ({
    default: module.XmlTagsFixture,
  })),
)

const InlineSourceFixture = lazy(() =>
  import('./inline-source-fixture').then((module) => ({
    default: module.InlineSourceFixture,
  })),
)

const CodeCompletionFixture = lazy(() =>
  import('./code-completion-fixture').then((module) => ({
    default: module.CodeCompletionFixture,
  })),
)

const ScriptMenusFixture = lazy(() =>
  import('./script-menus-fixture').then((module) => ({
    default: module.ScriptMenusFixture,
  })),
)

const SkillSourceFixture = lazy(() =>
  import('./skill-source-fixture').then((module) => ({
    default: module.SkillSourceFixture,
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

const SubagentApprovalsFixture = lazy(() =>
  import('./subagent-approvals-fixture').then((module) => ({
    default: module.SubagentApprovalsFixture,
  })),
)

const NotificationsFixture = lazy(() =>
  import('./notifications-fixture').then((module) => ({
    default: module.NotificationsFixture,
  })),
)

const AccountSecurityFixture = lazy(() =>
  import('./account-security-fixture').then((module) => ({
    default: module.AccountSecurityFixture,
  })),
)

const UiLayoutFixture = lazy(() =>
  import('./ui-layout-fixture').then((module) => ({
    default: module.UiLayoutFixture,
  })),
)

const SidebarFixture = lazy(() =>
  import('./sidebar-fixture').then((module) => ({
    default: module.SidebarFixture,
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
  new URLSearchParams(location.search).get('fixture') === 'mcp-settings' ? (
    <McpSettingsFixture />
  ) : new URLSearchParams(location.search).get('fixture') === 'mcp-catalog' ? (
    <McpCatalogFixture />
  ) : new URLSearchParams(location.search).get('fixture') === 'xml-tags' ? (
    <Suspense fallback={<p>Loading XML editors…</p>}>
      <XmlTagsFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') ===
    'notifications' ? (
    <Suspense fallback={<p>Loading notifications…</p>}>
      <NotificationsFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') === 'sidebar' ? (
    <Suspense fallback={<p>Loading sidebar…</p>}>
      <SidebarFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') === 'ui-layout' ? (
    <Suspense fallback={<p>Loading layout…</p>}>
      <UiLayoutFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') ===
    'subagent-approvals' ? (
    <Suspense fallback={<p>Loading approvals…</p>}>
      <SubagentApprovalsFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') ===
    'provider-connections' ? (
    <ProviderConnectionsFixture />
  ) : new URLSearchParams(location.search).get('fixture') === 'script-menus' ? (
    <Suspense fallback={<p>Loading menus…</p>}>
      <ScriptMenusFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') ===
    'code-completion' ? (
    <Suspense fallback={<p>Loading code editor…</p>}>
      <CodeCompletionFixture />
    </Suspense>
  ) : new URLSearchParams(location.search).get('fixture') ===
    'inline-source' ? (
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
  ) : new URLSearchParams(location.search).get('fixture') === 'skill-source' ? (
    <Suspense fallback={<p>Loading source picker…</p>}>
      <SkillSourceFixture />
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
