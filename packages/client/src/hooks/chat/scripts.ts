import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useMutation, useQuery } from 'convex/react'
import { useCallback } from 'react'

export type TextScript = {
  id: string
  name: string
  code: string
  icon: string
  pinned: boolean
  order: number
  createdAt: number
  updatedAt: number
}

export function useScripts() {
  const data = useQuery(api.editorScripts.list)
  const raw = data ?? []
  const createMutation = useMutation(api.editorScripts.create)
  const updateMutation = useMutation(api.editorScripts.update)
  const removeMutation = useMutation(api.editorScripts.remove)

  const scripts: TextScript[] = raw.map((s) => ({
    id: s._id,
    name: s.name,
    code: s.code,
    icon: s.icon,
    pinned: s.pinned,
    order: s.order,
    createdAt: s._creationTime,
    updatedAt: s._creationTime,
  }))

  const createScript = useCallback(
    async (
      data: Partial<Omit<TextScript, 'id' | 'createdAt' | 'updatedAt'>> = {},
    ): Promise<TextScript> => {
      const id = await createMutation({
        name: data.name ?? 'New script',
        code: data.code ?? 'return text',
        icon: data.icon ?? 'scroll-text',
        pinned: data.pinned ?? false,
        order: data.order,
      })
      return {
        id,
        name: data.name ?? 'New script',
        code: data.code ?? 'return text',
        icon: data.icon ?? 'scroll-text',
        pinned: data.pinned ?? false,
        order: data.order ?? scripts.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    },
    [createMutation, scripts.length],
  )

  const updateScript = useCallback(
    async (
      id: string,
      updates: Partial<
        Pick<TextScript, 'name' | 'code' | 'icon' | 'pinned' | 'order'>
      >,
    ): Promise<TextScript> => {
      await updateMutation({ scriptId: id as Id<'editorScripts'>, ...updates })
      const existing = scripts.find((s) => s.id === id)
      return {
        ...(existing ?? {
          id,
          name: '',
          code: '',
          icon: '',
          pinned: false,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        }),
        ...updates,
      }
    },
    [updateMutation, scripts],
  )

  const deleteScript = useCallback(
    async (id: string): Promise<void> => {
      await removeMutation({ scriptId: id as Id<'editorScripts'> })
    },
    [removeMutation],
  )

  return {
    scripts,
    loaded: data !== undefined,
    createScript,
    updateScript,
    deleteScript,
  }
}
