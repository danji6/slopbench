import { v } from 'convex/values'

import { internalMutation } from './_generated/server'
import * as ShellJobs from './model/shellJobs'
import * as V from './validators/args'

export const _register = internalMutation({
  args: V.shellJobRegisterArgsValidator.fields,
  handler: ShellJobs.register,
})

export const _release = internalMutation({
  args: { sessionId: v.id('sessions'), jobId: v.string() },
  handler: ShellJobs.release,
})

export const _beginWindow = internalMutation({
  args: { shellJobId: v.id('shellJobs') },
  handler: ShellJobs._beginWindow,
})

export const _carry = internalMutation({
  args: V.shellJobCarryArgsValidator.fields,
  handler: ShellJobs._carry,
})

export const _report = internalMutation({
  args: V.shellJobReportArgsValidator.fields,
  handler: ShellJobs._report,
})

export const refresh = internalMutation({
  args: {},
  handler: ShellJobs.refresh,
})
