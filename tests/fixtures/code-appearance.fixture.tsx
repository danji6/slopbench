import { CodeAppearanceContext } from '@/components/markdown/code-appearance'
import type { CodeAppearance } from '@/components/markdown/code-appearance'
import * as highlighter from '@/lib/shiki/highlighter'
import type { Id } from '@sb/convex/_generated/dataModel'
import { DEFAULT_SETTINGS } from '@sb/convex/model/defaults'
import { afterEach, beforeAll, expect, mock, spyOn, test } from 'bun:test'
import { act, useState } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'

import { setupDom } from '../setup/dom'

// Bun cannot expand Vite's font asset glob; rendering needs only the font helpers.
mock.module('@/fonts', () => ({
  FONT_NAMES: [],
  MONO_FONT_NAMES: [],
  getFontFamily: (font: string) => font,
  getMonoFontFamily: (font: string) => font,
  installFonts: () => {},
}))
const { StreamingCodeBlock } =
  await import('@/components/chat/messages/streaming-code-block')
const { MarkdownCode } = await import('@/components/markdown/code')
const { MessagePreview } = await import('@/components/chat/message-preview')
const { CodeBlockSetting } =
  await import('@/components/chat/entities/code-block-setting')
const agentHooks = await import('@/hooks/chat/agent')
const settingsHooks = await import('@/hooks/chat/settings')
const { useResolvedSettings } = await import('@/hooks/chat/resolved-settings')
const sessionHooks = await import('@/hooks/chat/session')
const queryHooks = await import('convex-helpers/react/cache/hooks')
const { useMessageAppearance } = await import('@/hooks/chat/appearances')

setupDom()
beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const SOURCE = 'const answer = 42\nconsole.log(answer)'
const HIGHLIGHTED =
  '<pre class="shiki"><code><span class="line"><span style="color:red">const answer = 42</span></span></code></pre>'
let cache: ReturnType<typeof spyOn<typeof highlighter, 'getCachedHighlight'>>
let root: Root | null = null

afterEach(() => {
  cache?.mockRestore()
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function renderCode(appearance: CodeAppearance, streaming: boolean) {
  return renderToStaticMarkup(
    <CodeAppearanceContext.Provider value={appearance}>
      {streaming ? (
        <StreamingCodeBlock className="language-ts">
          {SOURCE}
        </StreamingCodeBlock>
      ) : (
        <MarkdownCode text={SOURCE} language="ts" />
      )}
    </CodeAppearanceContext.Provider>,
  )
}

test('highlighting and line numbers work independently for static and streaming blocks', () => {
  cache = spyOn(highlighter, 'getCachedHighlight').mockReturnValue(HIGHLIGHTED)
  for (const streaming of [false, true]) {
    for (const highlighting of [false, true]) {
      for (const lineNumbers of [false, true]) {
        const html = renderCode({ highlighting, lineNumbers }, streaming)
        expect(html.includes('color:red')).toBe(highlighting)
        expect(html.includes('shiki-numbered')).toBe(lineNumbers)
        expect(html).toContain('class="line"')
        expect(html).toContain('const answer = 42')
      }
    }
  }
})

test('disabled highlighting ignores cached HTML and preserves raw code lines', () => {
  cache = spyOn(highlighter, 'getCachedHighlight').mockReturnValue(HIGHLIGHTED)
  for (const streaming of [false, true]) {
    const html = renderCode(
      { highlighting: false, lineNumbers: true },
      streaming,
    )
    expect(html).toContain('console.log(answer)')
  }
  expect(cache).not.toHaveBeenCalled()
})

test('code blocks keep highlighting and line numbers enabled by default', () => {
  cache = spyOn(highlighter, 'getCachedHighlight').mockReturnValue(HIGHLIGHTED)
  const defaults = renderToStaticMarkup(<MarkdownCode text={SOURCE} />)
  expect(defaults).toContain('color:red')
  expect(defaults).toContain('shiki-numbered')
})

test('appearance preview uses the edited preferences', () => {
  cache = spyOn(highlighter, 'getCachedHighlight').mockReturnValue(HIGHLIGHTED)
  const html = renderToStaticMarkup(
    <MessagePreview
      codeBlockHighlighting={false}
      codeBlockLineNumbers={false}
    />,
  )
  expect(html).not.toContain('color:red')
  expect(html).not.toContain('shiki-numbered')
  expect(html).toContain('Hello, World!')
})

test('an agent can disable an inherited preference and reset it to follow the user', async () => {
  function Harness() {
    const [value, setValue] = useState<boolean | null>(null)
    return (
      <CodeBlockSetting
        label="Code block highlighting"
        value={value}
        inheritedValue={true}
        onChange={setValue}
      />
    )
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<Harness />))
  const toggle = () =>
    container.querySelector<HTMLButtonElement>('[role="switch"]')!
  expect(toggle().getAttribute('aria-checked')).toBe('true')
  expect(container.textContent).toContain('Using your user setting.')
  await act(async () => toggle().click())
  expect(toggle().getAttribute('aria-checked')).toBe('false')
  expect(container.textContent).not.toContain('Using your user setting.')
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('[title="Use user setting"]')!
      .click(),
  )
  expect(toggle().getAttribute('aria-checked')).toBe('true')
  expect(container.textContent).toContain('Using your user setting.')
})

test('code preferences resolve each explicit agent value before the user and defaults', () => {
  const agent = spyOn(agentHooks, 'useActiveAgent').mockReturnValue(null)
  const settings = spyOn(settingsHooks, 'useSettings').mockReturnValue(
    undefined,
  )
  let resolved: ReturnType<typeof useResolvedSettings>
  function ReadSettings() {
    resolved = useResolvedSettings()
    return null
  }
  try {
    renderToStaticMarkup(<ReadSettings />)
    expect(resolved!.codeBlockHighlighting).toBe(true)
    expect(resolved!.codeBlockLineNumbers).toBe(true)
    settings.mockReturnValue({
      ...DEFAULT_SETTINGS,
      codeBlockHighlighting: false,
    } as ReturnType<typeof settingsHooks.useSettings>)
    renderToStaticMarkup(<ReadSettings />)
    expect(resolved!.codeBlockHighlighting).toBe(false)
    agent.mockReturnValue({
      _id: 'agent' as Id<'agents'>,
      name: 'Agent',
      codeBlockHighlighting: true,
      codeBlockLineNumbers: false,
    })
    renderToStaticMarkup(<ReadSettings />)
    expect(resolved!.codeBlockHighlighting).toBe(true)
    expect(resolved!.codeBlockLineNumbers).toBe(false)
  } finally {
    agent.mockRestore()
    settings.mockRestore()
  }
})

test('historical rows react to their sender styling and ignore the picked agent', () => {
  const appearance = (css: string, color: string, enabled: boolean) => ({
    customCss: css,
    theme: {
      source: color,
      light: { '--primary': color },
      dark: { '--primary': color },
    },
    codeBlockHighlighting: enabled,
    codeBlockLineNumbers: enabled,
  })
  const views: Record<string, ReturnType<typeof appearance> | null> = {
    first: appearance('.first {}', '#111111', false),
    second: appearance('.second {}', '#222222', true),
  }
  const agent = spyOn(agentHooks, 'useActiveAgent').mockReturnValue({
    _id: 'second' as Id<'agents'>,
    name: 'Second',
    ...views.second!,
  })
  const settings = spyOn(settingsHooks, 'useSettings').mockReturnValue({
    ...DEFAULT_SETTINGS,
    customCss: '.user {}',
  } as ReturnType<typeof settingsHooks.useSettings>)
  const session = spyOn(sessionHooks, 'useActiveSessionId').mockReturnValue(
    'session',
  )
  const query = spyOn(queryHooks, 'useQuery').mockImplementation(
    (_, ...queryArgs) =>
      (queryArgs[0] === 'skip'
        ? undefined
        : views[(queryArgs[0] as { agentId: string }).agentId]) as never,
  )
  const looks: Record<string, ReturnType<typeof useMessageAppearance>> = {}
  function Row({ id }: { id: string }) {
    looks[id] = useMessageAppearance('assistant', {
      sender: { type: 'agent', id: id as Id<'agents'> },
    })
    return <span>{id}</span>
  }
  function History() {
    return (
      <>
        <Row id="first" />
        <Row id="second" />
      </>
    )
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  try {
    act(() => root!.render(<History />))
    expect(looks.first.look.css).toEqual(['.user {}', '.first {}'])
    expect(looks.first.look.vars).toBe('--primary:#111111;')
    expect(looks.first.code).toEqual({
      highlighting: false,
      lineNumbers: false,
    })
    expect(looks.second.look.css).toEqual(['.user {}', '.second {}'])
    expect(looks.second.code).toEqual({ highlighting: true, lineNumbers: true })
    views.first = appearance('.changed {}', '#333333', true)
    act(() => root!.render(<History />))
    expect(looks.first.look.css).toEqual(['.user {}', '.changed {}'])
    expect(looks.first.look.vars).toBe('--primary:#333333;')
    expect(looks.first.code).toEqual({ highlighting: true, lineNumbers: true })
    expect(looks.second.look.vars).toBe('--primary:#222222;')
    agent.mockReturnValue(null)
    act(() => root!.render(<History />))
    expect(looks.first.look.vars).toBe('--primary:#333333;')
    views.first = null
    act(() => root!.render(<History />))
    expect(looks.first.look.css).toEqual(['.user {}', undefined])
    expect(looks.first.look.vars).not.toBe('--primary:#222222;')
  } finally {
    act(() => root?.unmount())
    root = null
    agent.mockRestore()
    settings.mockRestore()
    session.mockRestore()
    query.mockRestore()
  }
})
