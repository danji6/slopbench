import type { WorkspaceToolContext } from '@sb/convex/model/tool/context'
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from '@sb/convex/model/tool/files'
import { createShellTool } from '@sb/convex/model/tool/shellTools'
import { withAgentHome } from '@sb/core/workspace/personal'
import { expect, test } from 'bun:test'
import { z } from 'zod'

const project = { workspaceId: 'project', path: '/project', label: 'Project' }
const home = {
  ownerId: 'owner',
  agentId: 'agent',
  path: '/homes/agent',
  revision: 0,
}

test('file and shell descriptions follow home availability without leaking between agents', async () => {
  // Rebuild in both directions, including a session with only a personal home.
  for (const workspace of [
    project,
    withAgentHome(project, home),
    withAgentHome(undefined, home),
    project,
    undefined,
  ]) {
    const context = { workspace, shell: '/bin/fish' } as WorkspaceToolContext
    const tools = await Promise.all([
      createReadFileTool(context),
      createWriteFileTool(context),
      createEditFileTool(context),
      createShellTool(context),
    ])
    const available = !!workspace && 'agentHome' in workspace
    for (const tool of tools) {
      const schema = z.toJSONSchema(tool.inputSchema as z.ZodObject)
      expect(schema.properties?.scope).toBeUndefined()
      expect(typeof tool.description).toBe('string')
      expect((tool.description as string).includes('agent://')).toBe(available)
      expect(
        (tool.inputSchema as z.ZodObject).safeParse({
          path: 'file',
          command: 'pwd',
          scope: 'agent',
        }).success,
      ).toBe(false)
    }
    expect(tools[3].description).toContain('with fish')
  }
})
