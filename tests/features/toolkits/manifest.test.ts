import {
  toolkitWorkspaceSettings,
  validateToolkitManifest,
} from '@cv/core/types/toolkit'
import {
  toolkitCatalogSchema,
  toolkitSkillCatalog,
} from '@cv/sidecar/toolkits/catalog'
import {
  inspectToolkit,
  toolkitConnections,
} from '@cv/sidecar/toolkits/manifest'
import { readToolkitSkill } from '@cv/sidecar/toolkits/read'
import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function toolkit(manifest: unknown = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cv-toolkit-'))
  roots.push(root)
  await mkdir(path.join(root, '.agents'))
  await writeFile(
    path.join(root, '.agents/toolkit.json'),
    JSON.stringify(manifest),
  )
  return root
}
async function skill(root: string, name = 'review') {
  const directory = path.join(root, '.agents/skills', name)
  await mkdir(directory, { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Review evidence\n---\nλ😀 Literal {{ instructions }}`,
  )
  await writeFile(path.join(directory, 'references.txt'), 'Reference evidence')
}

test('only toolkit.json is accepted and renaming preserves the manifest revision', async () => {
  const raw = '{"name":"Existing kit"}\n'
  const root = await toolkit()
  const current = path.join(root, '.agents/toolkit.json')
  const legacy = path.join(root, '.agents/integration.json')
  await writeFile(current, raw)
  const before = await inspectToolkit(root)
  expect(before.revision).toBe(
    createHash('sha256').update('toolkit-root\0').update(raw).digest('hex'),
  )
  await rename(current, legacy)
  await expect(inspectToolkit(root)).rejects.toThrow('toolkit.json')
  await rename(legacy, current)
  expect((await inspectToolkit(root)).revision).toBe(before.revision)
  await writeFile(legacy, 'invalid old manifest')
  expect((await inspectToolkit(root)).manifest.name).toBe('Existing kit')
})

test('minimal and skills-only manifests default name/version without launching commands', async () => {
  const root = await toolkit({
    description: 'Only instructions',
    'x-extra': { safe: true },
  })
  const snapshot = await inspectToolkit(root)
  expect(snapshot.manifest.name).toBe(path.basename(root))
  expect(snapshot.manifest.schemaVersion).toBe(1)
  expect(snapshot.manifest.description).toBe('Only instructions')
  expect(toolkitConnections(snapshot)).toEqual([])
  expect(
    await toolkitSkillCatalog({
      sources: [
        {
          root,
          origin: 'Kit',
          toolkitId: 'one',
          revision: snapshot.revision,
          disabledSkills: [],
        },
      ],
      assigned: [],
      limit: 20,
      offset: 0,
    }),
  ).toMatchObject({ total: 0, entries: [] })
})

test('connection inference resolves paths against the toolkit root and leaves arguments literal', async () => {
  const root = await toolkit({
    mcpServers: {
      local: {
        command: './bin/server',
        args: ['$(touch bad)', '${workspace}', '$HOME'],
        cwd: 'work',
      },
      remote: { url: 'https://example.test/mcp' },
    },
  })
  const connections = toolkitConnections(await inspectToolkit(root))
  expect(connections[0]).toMatchObject({
    command: path.join(root, 'bin/server'),
    cwd: path.join(root, 'work'),
    transport: 'stdio',
    args: ['$(touch bad)', '${workspace}', '$HOME'],
  })
  const templated = toolkitConnections({
    ...(await inspectToolkit(root)),
    manifest: {
      schemaVersion: 1,
      mcpServers: {
        relative: { command: 'node', cwd: 'inputs/${workspace}/../cache' },
      },
    },
  })[0]
  expect(
    path.normalize(
      toolkitWorkspaceSettings(templated, '/targets/current').cwd!,
    ),
  ).toBe(path.join(root, 'inputs/targets/cache'))
  expect(connections[1].transport).toBe('auto')
  expect(toolkitWorkspaceSettings(connections[0], '/target').args).toEqual([
    '$(touch bad)',
    '/target',
    '$HOME',
  ])
  expect(() => toolkitWorkspaceSettings(connections[0])).toThrow(
    'requires a workspace',
  )
  expect(
    toolkitWorkspaceSettings(
      { env: { TARGET: '${workspace}', LITERAL: '$HOME' } },
      '/target',
    ).env,
  ).toEqual({ TARGET: '/target', LITERAL: '$HOME' })
})

test('root-based paths preserve defaults, parent traversal, absolute paths and workspace templates', async () => {
  const root = await toolkit()
  const snapshot = await inspectToolkit(root)
  for (const [cwd, expected] of [
    [undefined, root],
    ['.', root],
    ['.agents', path.join(root, '.agents')],
    ['../work', path.resolve(root, '../work')],
    ['/absolute/work', '/absolute/work'],
    ['${workspace}/work', '/targets/current/work'],
  ] as const) {
    const [connection] = toolkitConnections({
      ...snapshot,
      manifest: {
        schemaVersion: 1,
        mcpServers: { local: { command: 'node', cwd } },
      },
    })
    expect(connection.command).toBe('node')
    expect(toolkitWorkspaceSettings(connection, '/targets/current').cwd).toBe(
      expected,
    )
  }
  for (const command of ['./bin/server', '../server', '/absolute/server']) {
    const [connection] = toolkitConnections({
      ...snapshot,
      manifest: {
        schemaVersion: 1,
        mcpServers: { local: { command, cwd: 'work' } },
      },
    })
    expect(connection.command).toBe(path.resolve(root, command))
    expect(connection.cwd).toBe(path.join(root, 'work'))
  }
})

test('unsupported versions, ambiguous transports and executable settings fail explicitly', () => {
  for (const manifest of [
    { schemaVersion: 2 },
    { mcpServers: { one: { command: 'npx', url: 'https://example.test' } } },
    { mcpServers: { one: { command: 'npx', transport: 'http' } } },
    { mcpServers: { one: { url: 'https://example.test', args: ['x'] } } },
    { mcpServers: { one: { command: 'npx', env: { SECRET: 'no' } } } },
    { mcpServers: { one: { command: 'npx', install: 'curl | bash' } } },
    { mcpServers: { one: { command: '${workspace}/server' } } },
  ])
    expect(() => validateToolkitManifest(manifest)).toThrow()
  expect(
    validateToolkitManifest({
      mcpServers: {
        one: { command: 'npx', description: 'A tool', 'x-docs': 'metadata' },
      },
    }),
  ).toBeDefined()
})

test('only the exact root manifest is discovered; symlinks and oversized files are rejected', async () => {
  const root = await toolkit()
  await mkdir(path.join(root, 'nested'))
  await expect(inspectToolkit(path.join(root, 'nested'))).rejects.toThrow()
  const alias = path.join(root, 'alias')
  await symlink(path.join(root, '.agents/toolkit.json'), alias)
  await rm(path.join(root, '.agents/toolkit.json'))
  await writeFile(alias + '-target', '{}')
  await symlink(alias + '-target', path.join(root, '.agents/toolkit.json'))
  await expect(inspectToolkit(root)).rejects.toThrow('Symlink')
  await rm(path.join(root, '.agents/toolkit.json'))
  await writeFile(
    path.join(root, '.agents/toolkit.json'),
    ' '.repeat(128 * 1024 + 1),
  )
  await expect(inspectToolkit(root)).rejects.toThrow('128 KiB')
})

test('canonical skill directories merge origins before pagination; distinct copies keep identical names', async () => {
  const root = await toolkit()
  const second = await toolkit()
  await skill(root)
  await skill(second)
  const snapshot = await inspectToolkit(root)
  const sources = [
    { root, origin: 'Project: toolkit', disabledSkills: [] },
    {
      root: path.join(root, '.'),
      origin: 'Toolkit: toolkit',
      toolkitId: 'one',
      revision: snapshot.revision,
      disabledSkills: [],
    },
    { root: second, origin: 'Project: separate', disabledSkills: [] },
  ]
  const first = await toolkitSkillCatalog({
    sources,
    assigned: [],
    limit: 1,
    offset: 0,
  })
  const next = await toolkitSkillCatalog({
    sources,
    assigned: [],
    limit: 1,
    offset: 1,
  })
  expect(first.total).toBe(2)
  expect(next.total).toBe(2)
  expect(first.fingerprint).toBe(next.fingerprint)
  const merged = [...first.entries, ...next.entries].find(
    (row) => row.origins?.length === 2,
  )!
  expect(merged.origins).toEqual(['Project: toolkit', 'Toolkit: toolkit'])
  expect(merged.skill_id).toBe('review@toolkit:one')
  const removed = await toolkitSkillCatalog({
    sources: sources.slice(1),
    assigned: [],
    limit: 20,
    offset: 0,
  })
  expect(removed.fingerprint).not.toBe(first.fingerprint)
})

test('skill resources have bounded UTF-8 reads, reject traversal and symlinks, and fence replaced manifests', async () => {
  const root = await toolkit()
  await skill(root)
  const snapshot = await inspectToolkit(root)
  const input = {
    root,
    revision: snapshot.revision,
    name: 'review',
    resource: 'references.txt',
    offset: 0,
    length: 4,
  }
  expect(await readToolkitSkill(input)).toMatchObject({
    content: 'Refe',
    truncated: true,
    nextByteOffset: 4,
    readOnly: true,
  })
  await writeFile(path.join(root, '.agents/skills/review/unicode.txt'), 'λ😀')
  for (const length of [1, 2, 3]) {
    const tiny = { ...input, resource: 'unicode.txt', length }
    if (length === 1)
      await expect(readToolkitSkill(tiny)).rejects.toThrow('Byte budget')
    else
      expect(await readToolkitSkill(tiny)).toMatchObject({
        content: 'λ',
        nextByteOffset: 2,
      })
    await expect(readToolkitSkill({ ...tiny, offset: 2 })).rejects.toThrow(
      'Byte budget',
    )
  }
  await expect(
    readToolkitSkill({ ...input, resource: '../../../toolkit.json' }),
  ).rejects.toThrow('inside')
  await symlink(
    path.join(root, '.agents/toolkit.json'),
    path.join(root, '.agents/skills/review/link.txt'),
  )
  await expect(
    readToolkitSkill({ ...input, resource: 'link.txt' }),
  ).rejects.toThrow('Symlink')
  await writeFile(path.join(root, '.agents/toolkit.json'), '{"name":"Changed"}')
  await expect(readToolkitSkill(input)).rejects.toThrow('manifest changed')
})

test('project and toolkit discovery switches remain independent in all four combinations', async () => {
  const root = await toolkit()
  await skill(root)
  const snapshot = await inspectToolkit(root)
  const { combinedSkillCatalog } =
    await import('@cv/convex/model/skills/catalog')
  const { projectSkillCatalog } =
    await import('@cv/sidecar/agent-files/project-catalog')
  const original = globalThis.fetch
  const previousSecret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'toolkit-fixture'
  globalThis.fetch = Object.assign(
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return Response.json(
        String(url).endsWith('/toolkits/catalog')
          ? await toolkitSkillCatalog(toolkitCatalogSchema.parse(body))
          : await projectSkillCatalog(body),
      )
    },
    { preconnect: original.preconnect },
  )
  const linkedToolkit = {
    _id: 'one',
    root,
    name: 'Kit',
    revision: snapshot.revision,
    skillsEnabled: true,
    disabledSkills: [],
  }
  try {
    for (const projectOn of [false, true])
      for (const toolkitOn of [false, true]) {
        const page = await combinedSkillCatalog(
          {} as never,
          { _id: 'agent' } as never,
          {
            path: root,
            sources: [
              {
                id: 'root',
                path: root,
                label: 'Kit',
                discoverSkills: projectOn,
              },
            ],
          } as never,
          {},
          toolkitOn ? [linkedToolkit] : [],
        )
        expect(page.entries).toHaveLength(projectOn || toolkitOn ? 1 : 0)
        if (projectOn && toolkitOn)
          expect(page.entries[0].origins).toEqual([
            'Project: Kit',
            'Toolkit: Kit',
          ])
        if (projectOn && !toolkitOn)
          expect(page.entries[0].path).toBe(
            path.join(root, '.agents/skills/review/SKILL.md'),
          )
      }
  } finally {
    globalThis.fetch = original
    if (previousSecret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = previousSecret
  }
})

test('deduplication also merges assigned copies of the same canonical directory', async () => {
  const root = await toolkit()
  await skill(root)
  const snapshot = await inspectToolkit(root)
  const page = await toolkitSkillCatalog({
    sources: [
      {
        root,
        origin: 'Toolkit: Kit',
        toolkitId: 'one',
        revision: snapshot.revision,
        disabledSkills: [],
      },
    ],
    assigned: [
      {
        name: 'review',
        description: 'Review evidence',
        path: path.join(root, '.agents/skills/review/SKILL.md'),
        canonicalDirectory: path.join(root, '.agents/skills/review'),
        origin: 'Agent',
      },
    ],
    limit: 20,
    offset: 0,
  })
  expect(page.total).toBe(1)
  expect(page.entries[0].origins).toEqual(['Agent', 'Toolkit: Kit'])
})

test.skipIf(!Bun.which('mkfifo'))(
  'a nonregular manifest fails without blocking a sidecar request',
  async () => {
    const root = await toolkit()
    const file = path.join(root, '.agents/toolkit.json')
    await rm(file)
    expect(Bun.spawnSync(['mkfifo', file]).exitCode).toBe(0)
    await expect(inspectToolkit(root)).rejects.toThrow('regular file')
  },
)
