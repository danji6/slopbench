import { discover, link, refresh } from '@sb/convex/model/integrations/actions'
import { previewSkills } from '@sb/convex/model/integrations/skillPreview'
import { expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { integrationActionsFixture } from '~/tests/helpers/integration-actions'

test('public actions discover without launching and refresh applies the latest validated snapshot', async () => {
  const f = await integrationActionsFixture()
  const { root, action } = f
  try {
    await mkdir(path.join(root, '.agents'))
    const file = path.join(root, '.agents/integration.json')
    await writeFile(file, '{"name":"Before"}')
    const agentId = await f.db.insert('agents', {
      ownerId: 'owner',
      name: 'Agent',
    })
    const folderId = await f.db.insert('sessionFolders', {
      ownerId: 'owner',
      name: 'Project',
      revision: 1,
      sources: [
        { id: 'off', path: `${root}/unapproved`, label: 'Off' },
        { id: 'on', path: root, label: 'On', discoverIntegrations: true },
      ],
    })
    const sessionId = await f.db.insert('sessions', {
      ownerId: 'owner',
      activeAgentId: agentId,
      folderId,
    })
    await f.db.insert('userSessions', {
      sessionId,
      userId: 'owner',
      role: 'owner',
    })
    const candidates = await discover(action, sessionId as never)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].snapshot?.manifest.name).toBe('Before')
    expect(f.rows('integrations')).toHaveLength(0)
    const id = await link(action, root)
    expect(f.rows('integrations')).toHaveLength(1)
    expect(f.rows('mcpRuntimes')).toHaveLength(0)
    const directory = path.join(root, '.agents/skills/review')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SKILL.md'),
      '---\nname: review\ndescription: Review evidence\n---\nInstructions',
    )
    const components = await previewSkills(action, {
      integrationId: id,
      offset: 0,
    })
    expect(components.entries[0].name).toBe('review')
    expect(components.nextOffset).toBeNull()
    await writeFile(file, '{"name":"Proposed"}')
    expect(await refresh(action, id)).toEqual({
      integrationId: id,
      changed: true,
    })
    expect(f.rows('integrations')[0]).toMatchObject({
      name: 'Proposed',
      status: 'ready',
    })
    expect(await refresh(action, id)).toEqual({
      integrationId: id,
      changed: false,
    })
    await writeFile(file, '{"name":"Changed again"}')
    expect((await refresh(action, id)).changed).toBe(true)
    expect(f.rows('integrations')[0].name).toBe('Changed again')
    expect(f.rows('integrations')[0]).not.toHaveProperty('candidate')
    await rm(file)
    await expect(refresh(action, id)).rejects.toThrow()
    expect(f.rows('integrations')[0].status).toBe('missing')
  } finally {
    await f.dispose()
  }
})
