import { z } from 'zod'

export const homeSchema = z.object({
  ownerId: z.string(),
  agentId: z.string(),
  homeId: z.string().optional(),
  destinationHomeId: z.string().optional(),
  destinationOriginAgentId: z.string().optional(),
  originAgentId: z.string().optional(),
  path: z.string().optional(),
  revision: z.number().default(0),
})

export const operationSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  agentId: z.string().optional(),
  homeId: z.string().optional(),
  destinationHomeId: z.string().optional(),
  destinationOriginAgentId: z.string().optional(),
  originAgentId: z.string().optional(),
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
    'delete-home',
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

export const catalogSchema = homeSchema.extend({
  names: z.array(z.string()).max(20),
})

export const verifyLibrarySchema = z.object({
  ownerId: z.string(),
  skills: z.array(z.object({ skillId: z.string(), name: z.string() })).max(20),
})

export const agentLockSchema = z.object({
  agentId: z.string(),
  token: z.string(),
})

export const uploadProofSchema = z.object({
  fileUrl: z.string(),
  ticket: z.string(),
})

export const importPageSchema = z.object({
  id: z.string(),
  cursor: z.number().int().nonnegative(),
})
