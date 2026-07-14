import { api } from '@sb/convex/_generated/api'
import { minRole } from '@sb/convex/lib/roles'
import { useQuery } from 'convex/react'

import { useUserProfile } from './profile'

export function useTools() {
  const tools = useQuery(api.tools.list)
  return {
    tools: tools ?? [],
    isLoading: tools === undefined,
  }
}

export function useIsWorkspaceAdmin(): boolean {
  const { tools } = useTools()
  return tools.some((tool) => tool.name === 'shell')
}

export function useIsAdmin(): boolean {
  const profile = useUserProfile()
  return minRole(profile?.role, 'admin')
}
