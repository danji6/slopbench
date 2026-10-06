export type FolderNode = {
  _id: string
  parentId?: string
  name: string
  position: number
}

/** Returns ancestors followed by the selected folder, rejecting broken trees. */
export function folderTrail<T extends FolderNode>(
  folders: T[],
  id: string,
): T[] {
  const byId = new Map(folders.map((folder) => [folder._id, folder]))
  const seen = new Set<string>()
  const trail: T[] = []
  let current: string | undefined = id

  while (current) {
    const folder = byId.get(current)
    if (!folder || seen.has(current))
      throw new Error('Invalid folder hierarchy')
    seen.add(current)
    trail.unshift(folder)
    current = folder.parentId
  }

  return trail
}

export function folderSiblings<T extends FolderNode>(
  folders: T[],
  parentId?: string,
) {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.position - b.position || a._id.localeCompare(b._id))
}

/** Flattens the complete folder tree in sibling order, with paths and ancestry. */
export function orderedFolderTree<T extends FolderNode>(folders: T[]) {
  const entries = folders.map((folder) => {
    const trail = folderTrail(folders, folder._id)
    return {
      folder,
      depth: trail.length - 1,
      ancestorIds: trail.slice(0, -1).map((f) => f._id),
      path: trail.map((f) => f.name).join(' / '),
    }
  })

  const byId = new Map(entries.map((entry) => [entry.folder._id, entry]))
  const ordered: typeof entries = []

  function visit(parentId?: string) {
    for (const folder of folderSiblings(folders, parentId)) {
      ordered.push(byId.get(folder._id)!)
      visit(folder._id)
    }
  }
  visit()

  return ordered
}

export function folderBranch<T extends FolderNode>(
  folders: T[],
  id: string,
): T[] {
  return folders.filter((folder) =>
    folderTrail(folders, folder._id).some((f) => f._id === id),
  )
}

/** Applies a validated parent change and normalizes only affected sibling lists. */
export function projectFolderMove<T extends FolderNode>(
  folders: T[],
  input: {
    folderId: string
    parentId: string | null
    beforeFolderId?: string
  },
): T[] {
  const folder = folders.find((f) => f._id === input.folderId)
  if (!folder) throw new Error('Folder not found')

  const parentId = input.parentId ?? undefined
  const self =
    parentId && folderTrail(folders, parentId).some((f) => f._id === folder._id)
  if (self)
    throw new Error('Cannot move a folder into itself or its descendants')

  const siblings = folderSiblings(folders, parentId).filter(
    (f) => f._id !== folder._id,
  )

  const index = input.beforeFolderId
    ? siblings.findIndex((f) => f._id === input.beforeFolderId)
    : siblings.length
  if (index < 0) throw new Error('Folder list changed, try again')

  siblings.splice(index, 0, folder)
  const positions = new Map(siblings.map((f, position) => [f._id, position]))

  if (folder.parentId !== parentId) {
    folderSiblings(folders, folder.parentId)
      .filter((f) => f._id !== folder._id)
      .forEach((f, position) => positions.set(f._id, position))
  }

  return folders.map((f) => ({
    ...f,
    ...(f._id === folder._id ? { parentId } : {}),
    position: positions.get(f._id) ?? f.position,
  }))
}
