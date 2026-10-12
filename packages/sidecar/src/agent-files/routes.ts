import { Hono } from 'hono'
import { z } from 'zod'

import { lockAgent, unlockAgent, withAgentFiles } from './access'
import { importPage } from './import-discovery'
import { readSkillMetadata } from './metadata'
import { homeInfo, runFileOperation, skillCopy } from './operations'
import { resolveHome } from './storage'
import { verifySkillUpload } from './upload'

const homeSchema = z.object({
  ownerId: z.string(),
  agentId: z.string(),
  path: z.string().optional(),
  revision: z.number().default(0),
})

const operationSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  agentId: z.string().optional(),
  homePath: z.string().optional(),
  destination: z.string().optional(),
  skillId: z.string().optional(),
  name: z.string().optional(),
  ticket: z.string().optional(),
  source: z.string().optional(),
  fileUrl: z.string().optional(),
  homeOperationId: z.string().optional(),
  copyFiles: z.boolean().optional(),
  kind: z.enum([
    'install',
    'discover-import',
    'assign',
    'delete-assigned',
    'delete-library',
    'prepare-home',
    'stage-home-skill',
    'publish-home',
    'duplicate',
  ]),
})

const catalogSchema = homeSchema.extend({ names: z.array(z.string()).max(20) })

export const agentFilesRoutes = new Hono()
const lockSchema = z.object({ agentId: z.string(), token: z.string() })

agentFilesRoutes.post('/lock', async (c) => {
  const input = lockSchema.parse(await c.req.json())
  await lockAgent(input.agentId, input.token)
  return c.json({ ok: true })
})

agentFilesRoutes.post('/unlock', async (c) => {
  const input = lockSchema.parse(await c.req.json())
  unlockAgent(input.agentId, input.token)
  return c.json({ ok: true })
})

agentFilesRoutes.post('/home', async (c) =>
  c.json(await homeInfo(homeSchema.parse(await c.req.json()))),
)

agentFilesRoutes.post('/verify-upload', async (c) => {
  const input = z
    .object({ fileUrl: z.string(), ticket: z.string() })
    .parse(await c.req.json())
  return c.json({
    verified: await verifySkillUpload(input.fileUrl, input.ticket),
  })
})

agentFilesRoutes.post('/operation', async (c) =>
  c.json(await runFileOperation(operationSchema.parse(await c.req.json()))),
)

agentFilesRoutes.post('/import-page', async (c) => {
  const input = z
    .object({ id: z.string(), cursor: z.number().int().nonnegative() })
    .parse(await c.req.json())
  return c.json(await importPage(input.id, input.cursor))
})

agentFilesRoutes.post('/metadata', async (c) => {
  const input = catalogSchema.parse(await c.req.json())
  return withAgentFiles(input.agentId, async () => {
    const home = await resolveHome(input.ownerId, input.agentId, input.path)
    const entries = []
    for (const name of input.names) {
      const absolutePath = skillCopy(home, name)
      const relativePath = `.agents/skills/${name}/SKILL.md`
      try {
        const metadata = await readSkillMetadata(absolutePath)
        if (metadata.name !== name) {
          throw new Error('Skill name must match its directory')
        }
        entries.push({
          ...metadata,
          path: relativePath,
          absolutePath: `${absolutePath}/SKILL.md`,
        })
      } catch (error) {
        entries.push({
          name,
          description: '',
          path: relativePath,
          error:
            error instanceof Error
              ? error.message
              : 'Skill metadata unavailable',
        })
      }
    }
    return c.json({ entries })
  })
})

agentFilesRoutes.onError((error, c) =>
  c.json({ error: error.message }, error instanceof z.ZodError ? 400 : 409),
)
