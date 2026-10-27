import { sweepOrphanDefinitions } from '@sb/convex/model/mcpCatalogCleanup'
import { MCP_DEFINITION_CONTENT_TYPE } from '@sb/core/types/mcp-catalog'
import { expect, test } from 'bun:test'
import { skillsDatabase } from '~/tests/helpers/skills-db'

test('orphan sweeping removes only old unreferenced MCP definition uploads', async () => {
  const { ctx, db } = skillsDatabase()
  const deleted: string[] = []
  Object.assign(db, { system: { query: db.query } })
  Object.assign(ctx, {
    storage: {
      delete: async (id: string) => {
        deleted.push(id)
      },
    },
  })
  const old = Date.now() - 2 * 60 * 60_000
  const abandoned = await db.insert('_storage', {
    _creationTime: old,
    contentType: MCP_DEFINITION_CONTENT_TYPE,
  })
  const referenced = await db.insert('_storage', {
    _creationTime: old,
    contentType: MCP_DEFINITION_CONTENT_TYPE,
  })
  await db.insert('mcpCatalogTools', { definitionRef: referenced })
  await db.insert('_storage', {
    _creationTime: old,
    contentType: 'application/json',
  })
  await db.insert('_storage', {
    _creationTime: Date.now(),
    contentType: MCP_DEFINITION_CONTENT_TYPE,
  })
  await sweepOrphanDefinitions(ctx, {})
  expect(deleted).toEqual([abandoned])
})
