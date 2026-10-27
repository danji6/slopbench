import { resolvePersonalWorkspace } from '@sb/convex/model/skills/runtime'
import type { AgentWithHome } from '@sb/convex/types'
import { expect, test } from 'bun:test'

const project = { workspaceId: 'project', path: '/project', label: 'Project' }

test('agents with no assigned folder never resolve or silently recreate a personal home', async () => {
  const original = globalThis.fetch
  let requests = 0
  globalThis.fetch = (async () => {
    requests++
    throw new Error('Must not contact the sidecar')
  }) as unknown as typeof fetch
  try {
    const agent = {
      _id: 'agent',
      ownerId: 'owner',
      name: 'Agent',
      home: null,
    } as AgentWithHome
    expect(await resolvePersonalWorkspace(agent, project)).toEqual(project)
    expect(await resolvePersonalWorkspace(agent)).toBeUndefined()
    expect(requests).toBe(0)
  } finally {
    globalThis.fetch = original
  }
})

test('a missing assigned home leaves the project usable without resolving the deleted path', async () => {
  const original = globalThis.fetch
  const secret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'fixture-secret'
  const requests: string[] = []
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    requests.push(String(input))
    return Response.json({ exists: false })
  }) as unknown as typeof fetch
  try {
    const agent = {
      _id: 'agent',
      ownerId: 'owner',
      name: 'Agent',
      homeId: 'home',
      home: { path: '/deleted/home', originAgentId: 'agent' },
    } as AgentWithHome
    expect(await resolvePersonalWorkspace(agent, project)).toEqual(project)
    expect(await resolvePersonalWorkspace(agent)).toBeUndefined()
    expect(
      requests.every((request) => request.endsWith('/agent-files/status')),
    ).toBe(true)
  } finally {
    globalThis.fetch = original
    if (secret === undefined) delete process.env.SIDECAR_SECRET
    else process.env.SIDECAR_SECRET = secret
  }
})
