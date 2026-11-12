import { modelReference } from '@sb/core/model-reference'
import type { ModelEntry } from '@sb/core/types'

import type { Id } from '../../_generated/dataModel'
import { error } from '../../errors'

type ModelRename = { from: string; to: string }

/** Records explicit edits to rows present before and after the save. */
export function addModelRenames(
  references: Map<string, string>,
  connectionId: Id<'modelProviders'>,
  previous: ModelEntry[],
  next: ModelEntry[],
  renames: ModelRename[],
) {
  const previousIds = new Set(previous.map((model) => model.id.trim()))
  const nextIds = new Set(next.map((model) => model.id.trim()))
  const targets = new Set<string>()

  for (const { from, to } of renames) {
    const source = modelReference(connectionId, from)
    if (from === to || !previousIds.has(from) || !nextIds.has(to)) {
      error('Model ID changed. Reload before saving.', 409)
    }
    if (references.has(source) || targets.has(to)) {
      error('Duplicate model rename', 400)
    }
    references.set(source, modelReference(connectionId, to))
    targets.add(to)
  }
}
