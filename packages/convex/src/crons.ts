import { cronJobs } from 'convex/server'

import { internal } from './_generated/api'

const crons = cronJobs()

crons.daily(
  'prune orphaned attachments',
  { hourUTC: 3, minuteUTC: 0 },
  internal.attachments.pruneOrphans,
)

crons.interval(
  'recover expired chat streams',
  { minutes: 1 },
  internal.streams.prune,
)

crons.daily(
  'prune orphaned tool outputs',
  { hourUTC: 3, minuteUTC: 30 },
  internal.streams.pruneOrphanedOutputs,
)

crons.interval(
  'prune stale typing indicators',
  { minutes: 5 },
  internal.typing.prune,
)

crons.interval(
  'recover stale shell job watchers',
  { minutes: 5 },
  internal.shellJobs.refresh,
)

export default crons
