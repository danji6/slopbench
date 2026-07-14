'use node'

import { v } from 'convex/values'

import { action, internalAction } from '../_generated/server'
import {
  terminalKillArgsValidator,
  terminalPollArgsValidator,
  terminalResizeArgsValidator,
  terminalSessionArgsValidator,
  terminalWriteArgsValidator,
} from '../validators/args'
import * as Terminal from './tool/terminal'

export const write = action({
  args: terminalWriteArgsValidator.fields,
  handler: Terminal.write,
})

export const kill = action({
  args: terminalKillArgsValidator.fields,
  handler: Terminal.kill,
})

export const resize = action({
  args: terminalResizeArgsValidator.fields,
  handler: Terminal.resize,
})

export const background = action({
  args: terminalKillArgsValidator.fields,
  handler: Terminal.background,
})

export const list = action({
  args: terminalSessionArgsValidator.fields,
  handler: Terminal.list,
})

export const poll = action({
  args: terminalPollArgsValidator.fields,
  handler: Terminal.poll,
})

export const killAll = action({
  args: terminalSessionArgsValidator.fields,
  handler: Terminal.killAll,
})

export const _killSessionJobs = internalAction({
  args: { sessionId: v.id('sessions') },
  handler: Terminal._killSessionJobs,
})
