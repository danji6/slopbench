import type { StreamContext } from '../../types'
import {
  formatWorkspaceInstructions,
  tryReadWorkspaceInstructions,
} from '../session/workspace'
import type { WirePromptItem } from './prompts'

export async function resolveDynamicPromptMarkers(
  data: StreamContext,
  prompts: WirePromptItem[],
): Promise<WirePromptItem[]> {
  if (!prompts.some(isAgentsMarker)) return prompts

  const workspaceInstructions = await tryReadWorkspaceInstructions(data)

  return prompts
    .map((item): WirePromptItem | null => {
      if (!isAgentsMarker(item)) return item
      if (!workspaceInstructions?.content.trim()) return null
      return {
        id: item.id,
        name: workspaceInstructions.path,
        role: 'system',
        content: formatWorkspaceInstructions(workspaceInstructions),
        enabled: true,
        visible: false,
        starter: false,
      }
    })
    .filter((item): item is WirePromptItem => item !== null)
}

function isAgentsMarker(item: WirePromptItem) {
  return 'type' in item && item.type === 'agents'
}
