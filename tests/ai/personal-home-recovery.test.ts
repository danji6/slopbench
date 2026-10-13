import type { Doc } from '@sb/convex/_generated/dataModel'
import { resolvePersonalWorkspace } from '@sb/convex/model/skills/runtime'
import { expect, test } from 'bun:test'

const project = { workspaceId: 'project', path: '/project', label: 'Project' }

test('detached agents never resolve or silently recreate a personal home', async () => {
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
      homeDetached: true,
    } as Doc<'agents'>
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
      homePath: '/deleted/home',
    } as Doc<'agents'>
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
