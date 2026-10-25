import {
  integrationWorkspaceSettings,
  validateIntegrationManifest,
} from '@sb/core/types/integration'
import {
  integrationCatalogSchema,
  integrationSkillCatalog,
} from '@sb/sidecar/integrations/catalog'
import {
  inspectIntegration,
  integrationConnections,
} from '@sb/sidecar/integrations/manifest'
import { readIntegrationSkill } from '@sb/sidecar/integrations/read'
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})
async function toolkit(manifest: unknown = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'sb-integration-'))
  roots.push(root)
  await mkdir(path.join(root, '.agents'))
  await writeFile(
    path.join(root, '.agents/integration.json'),
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

test('minimal and skills-only manifests default name/version without launching commands', async () => {
  const root = await toolkit({
    description: 'Only instructions',
    'x-extra': { safe: true },
  })
  const snapshot = await inspectIntegration(root)
  expect(snapshot.manifest.name).toBe(path.basename(root))
  expect(snapshot.manifest.schemaVersion).toBe(1)
  expect(integrationConnections(snapshot)).toEqual([])
  expect(
    await integrationSkillCatalog({
      sources: [
        {
          root,
          origin: 'Kit',
          integrationId: 'one',
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
  const connections = integrationConnections(await inspectIntegration(root))
  expect(connections[0]).toMatchObject({
    command: path.join(root, 'bin/server'),
    cwd: path.join(root, 'work'),
    transport: 'stdio',
    args: ['$(touch bad)', '${workspace}', '$HOME'],
  })
  const templated = integrationConnections({
    ...(await inspectIntegration(root)),
    manifest: {
      schemaVersion: 1,
      mcpServers: {
        relative: { command: 'node', cwd: 'inputs/${workspace}/../cache' },
      },
    },
  })[0]
  expect(
    path.normalize(
      integrationWorkspaceSettings(templated, '/targets/current').cwd!,
    ),
  ).toBe(path.join(root, 'inputs/targets/cache'))
  expect(connections[1].transport).toBe('auto')
  expect(integrationWorkspaceSettings(connections[0], '/target').args).toEqual([
    '$(touch bad)',
    '/target',
    '$HOME',
  ])
  expect(() => integrationWorkspaceSettings(connections[0])).toThrow(
    'requires a workspace',
  )
  expect(
    integrationWorkspaceSettings(
      { env: { TARGET: '${workspace}', LITERAL: '$HOME' } },
      '/target',
    ).env,
  ).toEqual({ TARGET: '/target', LITERAL: '$HOME' })
})

test('root-based paths preserve defaults, parent traversal, absolute paths and workspace templates', async () => {
  const root = await toolkit()
  const snapshot = await inspectIntegration(root)
  for (const [cwd, expected] of [
    [undefined, root],
    ['.', root],
    ['.agents', path.join(root, '.agents')],
    ['../work', path.resolve(root, '../work')],
    ['/absolute/work', '/absolute/work'],
    ['${workspace}/work', '/targets/current/work'],
  ] as const) {
    const [connection] = integrationConnections({
      ...snapshot,
      manifest: {
        schemaVersion: 1,
        mcpServers: { local: { command: 'node', cwd } },
      },
    })
    expect(connection.command).toBe('node')
    expect(
      integrationWorkspaceSettings(connection, '/targets/current').cwd,
    ).toBe(expected)
  }
  for (const command of ['./bin/server', '../server', '/absolute/server']) {
    const [connection] = integrationConnections({
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
    expect(() => validateIntegrationManifest(manifest)).toThrow()
  expect(
    validateIntegrationManifest({
      mcpServers: {
        one: { command: 'npx', description: 'A tool', 'x-docs': 'metadata' },
      },
    }),
  ).toBeDefined()
})

test('only the exact root manifest is discovered; symlinks and oversized files are rejected', async () => {
  const root = await toolkit()
  await mkdir(path.join(root, 'nested'))
  await expect(inspectIntegration(path.join(root, 'nested'))).rejects.toThrow()
  const alias = path.join(root, 'alias')
  await symlink(path.join(root, '.agents/integration.json'), alias)
  await rm(path.join(root, '.agents/integration.json'))
  await writeFile(alias + '-target', '{}')
  await symlink(alias + '-target', path.join(root, '.agents/integration.json'))
  await expect(inspectIntegration(root)).rejects.toThrow('Symlink')
  await rm(path.join(root, '.agents/integration.json'))
  await writeFile(
    path.join(root, '.agents/integration.json'),
    ' '.repeat(128 * 1024 + 1),
  )
  await expect(inspectIntegration(root)).rejects.toThrow('128 KiB')
})

test('canonical skill directories merge origins before pagination; distinct copies keep identical names', async () => {
  const root = await toolkit()
  const second = await toolkit()
  await skill(root)
  await skill(second)
  const snapshot = await inspectIntegration(root)
  const sources = [
    { root, origin: 'Project: toolkit', disabledSkills: [] },
    {
      root: path.join(root, '.'),
      origin: 'Integration: toolkit',
      integrationId: 'one',
      revision: snapshot.revision,
      disabledSkills: [],
    },
    { root: second, origin: 'Project: separate', disabledSkills: [] },
  ]
  const first = await integrationSkillCatalog({
    sources,
    assigned: [],
    limit: 1,
    offset: 0,
  })
  const next = await integrationSkillCatalog({
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
  expect(merged.origins).toEqual(['Integration: toolkit', 'Project: toolkit'])
  expect(merged.path).toBe('integration://one/skills/review/SKILL.md')
  const removed = await integrationSkillCatalog({
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
  const snapshot = await inspectIntegration(root)
  const input = {
    root,
    revision: snapshot.revision,
    name: 'review',
    resource: 'references.txt',
    offset: 0,
    length: 4,
  }
  expect(await readIntegrationSkill(input)).toMatchObject({
    content: 'Refe',
    truncated: true,
    nextByteOffset: 4,
    readOnly: true,
  })
  await writeFile(path.join(root, '.agents/skills/review/unicode.txt'), 'λ😀')
  for (const length of [1, 2, 3]) {
    const tiny = { ...input, resource: 'unicode.txt', length }
    if (length === 1)
      await expect(readIntegrationSkill(tiny)).rejects.toThrow('Byte budget')
    else
      expect(await readIntegrationSkill(tiny)).toMatchObject({
        content: 'λ',
        nextByteOffset: 2,
      })
    await expect(readIntegrationSkill({ ...tiny, offset: 2 })).rejects.toThrow(
      'Byte budget',
    )
  }
  await expect(
    readIntegrationSkill({ ...input, resource: '../../../integration.json' }),
  ).rejects.toThrow('inside')
  await symlink(
    path.join(root, '.agents/integration.json'),
    path.join(root, '.agents/skills/review/link.txt'),
  )
  await expect(
    readIntegrationSkill({ ...input, resource: 'link.txt' }),
  ).rejects.toThrow('Symlink')
  await writeFile(
    path.join(root, '.agents/integration.json'),
    '{"name":"Changed"}',
  )
  await expect(readIntegrationSkill(input)).rejects.toThrow('manifest changed')
})

test('project and integration discovery switches remain independent in all four combinations', async () => {
  const root = await toolkit()
  await skill(root)
  const snapshot = await inspectIntegration(root)
  const { combinedSkillCatalog } =
    await import('@sb/convex/model/skills/catalog')
  const { projectSkillCatalog } =
    await import('@sb/sidecar/agent-files/project-catalog')
  const original = globalThis.fetch
  const previousSecret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'integration-fixture'
  globalThis.fetch = Object.assign(
    async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      return Response.json(
        String(url).endsWith('/integrations/catalog')
          ? await integrationSkillCatalog(integrationCatalogSchema.parse(body))
          : await projectSkillCatalog(body),
      )
    },
    { preconnect: original.preconnect },
  )
  const integration = {
    _id: 'one',
    root,
    name: 'Kit',
    revision: snapshot.revision,
    skillsEnabled: true,
    disabledSkills: [],
  }
  try {
    for (const projectOn of [false, true])
      for (const integrationOn of [false, true]) {
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
          integrationOn ? [integration] : [],
        )
        expect(page.entries).toHaveLength(projectOn || integrationOn ? 1 : 0)
        if (projectOn && integrationOn)
          expect(page.entries[0].origins).toEqual([
            'Integration: Kit',
            'Project: Kit',
          ])
        if (projectOn && !integrationOn)
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
  const snapshot = await inspectIntegration(root)
  const page = await integrationSkillCatalog({
    sources: [
      {
        root,
        origin: 'Integration: Kit',
        integrationId: 'one',
        revision: snapshot.revision,
        disabledSkills: [],
      },
    ],
    assigned: [
      {
        name: 'review',
        description: 'Review evidence',
        path: 'agent://skills/review/SKILL.md',
        canonicalDirectory: path.join(root, '.agents/skills/review'),
        origin: 'Agent',
      },
    ],
    limit: 20,
    offset: 0,
  })
  expect(page.total).toBe(1)
  expect(page.entries[0].origins).toEqual(['Agent', 'Integration: Kit'])
})

test.skipIf(!Bun.which('mkfifo'))(
  'a nonregular manifest fails without blocking a sidecar request',
  async () => {
    const root = await toolkit()
    const file = path.join(root, '.agents/integration.json')
    await rm(file)
    expect(Bun.spawnSync(['mkfifo', file]).exitCode).toBe(0)
    await expect(inspectIntegration(root)).rejects.toThrow('regular file')
  },
)
