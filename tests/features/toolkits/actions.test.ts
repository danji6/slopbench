import { discover, link, refresh } from '@sb/convex/model/toolkits/actions'
import { previewSkills } from '@sb/convex/model/toolkits/skillPreview'
import { expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { toolkitActionsFixture } from '~/tests/helpers/toolkit-actions'

test('public actions discover without launching and refresh applies the latest validated snapshot', async () => {
  const f = await toolkitActionsFixture()
  const { root, action } = f
  try {
    await mkdir(path.join(root, '.agents'))
    const file = path.join(root, '.agents/toolkit.json')
    await writeFile(file, '{"name":"Before"}')
    const disabled = {
      id: 'off',
      path: `${root}/disabled`,
      label: 'Off',
      discoverToolkits: false,
    }
    const enabled = {
      id: 'on',
      path: root,
      label: 'On',
      discoverToolkits: true,
    }
    const folderId = await f.db.insert('sessionFolders', {
      ownerId: 'owner',
      name: 'Project',
      revision: 1,
      sources: [disabled, { ...enabled, discoverToolkits: false }],
    })
    const childFolderId = await f.db.insert('sessionFolders', {
      ownerId: 'owner',
      parentId: folderId,
      name: 'Child',
      revision: 0,
      sources: [],
    })
    const sessionId = await f.db.insert('sessions', {
      ownerId: 'owner',
      folderId: childFolderId,
    })
    await f.db.insert('userSessions', {
      sessionId,
      userId: 'owner',
      role: 'owner',
    })
    expect(await discover(action, sessionId as never)).toEqual([])
    await f.db.patch(folderId, { sources: [disabled, enabled] })

    const candidates = await discover(action, sessionId as never)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].snapshot?.manifest.name).toBe('Before')
    expect(await f.db.get(folderId)).toMatchObject({
      revision: 1,
      sources: [disabled, enabled],
    })
    expect(f.rows('toolkits')).toHaveLength(0)
    const id = await link(action, root)
    expect(f.rows('toolkits')).toHaveLength(1)
    expect(f.rows('mcpRuntimes')).toHaveLength(0)
    const directory = path.join(root, '.agents/skills/review')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'SKILL.md'),
      '---\nname: review\ndescription: Review evidence\n---\nInstructions',
    )
    const components = await previewSkills(action, {
      toolkitId: id,
      offset: 0,
    })
    expect(components.entries[0].name).toBe('review')
    expect(components.nextOffset).toBeNull()
    await writeFile(file, '{"name":"Proposed"}')
    expect(await refresh(action, id)).toEqual({
      toolkitId: id,
      changed: true,
    })
    expect(f.rows('toolkits')[0]).toMatchObject({
      name: 'Proposed',
      status: 'ready',
    })
    expect(await refresh(action, id)).toEqual({
      toolkitId: id,
      changed: false,
    })
    await writeFile(file, '{"name":"Changed again"}')
    expect((await refresh(action, id)).changed).toBe(true)
    expect(f.rows('toolkits')[0].name).toBe('Changed again')
    expect(f.rows('toolkits')[0]).not.toHaveProperty('candidate')
    await rm(file)
    await expect(refresh(action, id)).rejects.toThrow()
    expect(f.rows('toolkits')[0].status).toBe('missing')
  } finally {
    await f.dispose()
  }
})
