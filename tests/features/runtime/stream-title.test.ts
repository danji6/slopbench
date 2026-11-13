import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { Id } from '@cv/convex/_generated/dataModel'
import type { ActionCtx, MutationCtx } from '@cv/convex/_generated/server'
import { generateTitle } from '@cv/convex/actions/session/title'
import { _stream } from '@cv/convex/actions/stream/engine'
import * as EngineSetup from '@cv/convex/actions/stream/engineSetup'
import { reserveOrDebounceTurn } from '@cv/convex/model/chat/reserve'
import { _patchTitle } from '@cv/convex/model/session/title'
import { _saveMeta } from '@cv/convex/model/stream/lifecycleMeta'
import { _patchMessage } from '@cv/convex/model/stream/lifecycleProgress'
import { _complete } from '@cv/convex/model/stream/lifecycleTerminal'
import { requestImmediateStop } from '@cv/convex/model/stream/stop'
import { _suspendStep } from '@cv/convex/model/stream/subagents'
import { TITLE_EXCERPT_LENGTH } from '@cv/core/title-generation'
import { tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { expect, spyOn, test } from 'bun:test'
import { getFunctionName } from 'convex/server'
import { z } from 'zod'
import { skillsDatabase } from '~/tests/helpers/skills-db'
import { startTitleProvider } from '~/tests/helpers/title-provider'

const sessionId = 'session' as Id<'sessions'>
const execution = { streamId: 'stream' as Id<'streams'>, generation: 1 }
type Reference = Parameters<typeof getFunctionName>[0]
type Setup = NonNullable<Awaited<ReturnType<typeof EngineSetup.prepare>>>

function streamFixture() {
  const { db, rows, ctx } = skillsDatabase()
  const session = { _id: sessionId, ownerId: 'owner' }
  rows('sessions').push(session)
  const stream = {
    _id: execution.streamId,
    generation: execution.generation,
    sessionId,
    agentId: 'agent',
    invokedBy: 'owner',
    command: { kind: 'invoke' },
    state: {
      phase: 'streaming',
      processingMessageId: 'reply',
      processingContentId: 'reply-content',
    },
    suppressFollowUp: true,
  }
  rows('streams').push(stream)
  rows('messages').push({
    _id: 'reply',
    sessionId,
    role: 'assistant',
    status: 'processing',
    selectedVersion: 1,
  })
  rows('messageContents').push({
    _id: 'reply-content',
    messageId: 'reply',
    version: 1,
    segmentIndex: 0,
    parts: [],
  })

  Object.assign(db, {
    system: { get: (_table: string, id: string) => db.get(id) },
  })
  Object.assign(ctx.scheduler, {
    runAfter: async (_delay: number, ref: Reference, args: unknown) =>
      db.insert('_scheduled_functions', {
        name: getFunctionName(ref),
        args,
        state: { kind: 'pending' },
      }),
  })
  const titleJobs = () =>
    rows('_scheduled_functions').filter(
      (row) => row.name === 'actions/sessions:_generateTitle',
    )
  return { db, ctx, session, stream, titleJobs }
}

function providerStep(step: number, text: string, callTool: boolean) {
  const id = `text-${step}`
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] })
      if (text) {
        controller.enqueue({ type: 'text-start', id })
        controller.enqueue({ type: 'text-delta', id, delta: text })
        controller.enqueue({ type: 'text-end', id })
      }
      if (callTool) {
        controller.enqueue({
          type: 'tool-call',
          toolCallId: `tool-${step}`,
          toolName: 'lookup',
          input: '{}',
        })
      }
      controller.enqueue({
        type: 'finish',
        finishReason: {
          unified: callTool ? 'tool-calls' : 'stop',
          raw: undefined,
        },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      })
      controller.close()
    },
  })
}

function streamAction(ctx: MutationCtx, baseURL?: string) {
  const savedExcerpts: (string | undefined)[] = []
  const action = {
    storage: { store: async () => 'log' },
    runQuery: async (ref: Reference, args: { assistantText?: string }) => {
      switch (getFunctionName(ref)) {
        case 'streams:_getStopState':
          return 'active'
        case 'streams:_isActive':
          return true
        case 'mcpOperations:_pending':
          return []
        case 'chat:_changeSetForStream':
          return null
        case 'sessions:_getTitleContext':
          return {
            exchange: `User: Plan a weekend in Rome.\nAssistant: ${args.assistantText}`,
            systemPrompt: 'Write a title.',
            modelId: 'title-model',
            credentials: { providerId: 'custom', baseURL, apiKey: 'fixture' },
          }
        default:
          throw new Error(`Unexpected query ${getFunctionName(ref)}`)
      }
    },
    runMutation: async (ref: Reference, args: never) => {
      switch (getFunctionName(ref)) {
        case 'streams:_claim':
          return { attempt: 0, command: { kind: 'invoke' } }
        case 'streams:_patchMessage':
          return _patchMessage(ctx, args)
        case 'streams:_saveMeta':
          savedExcerpts.push((args as { titleText?: string }).titleText)
          return _saveMeta(ctx, args)
        case 'streams:_complete':
          return _complete(ctx, args)
        case 'streams:_suspendStep':
          return _suspendStep(ctx, args)
        case 'sessions:_patchTitle':
          return _patchTitle(ctx, args)
        case 'streams:_saveLog':
        case 'streams:_heartbeat':
        case 'streams:_recordStep':
        case 'streams:_continue':
          return true
        default:
          throw new Error(`Unexpected mutation ${getFunctionName(ref)}`)
      }
    },
  } as unknown as ActionCtx
  return { action, savedExcerpts }
}

function stubPreparation(
  f: ReturnType<typeof streamFixture>,
  model: MockLanguageModelV4,
  needsApproval = false,
) {
  return spyOn(EngineSetup, 'prepare').mockImplementation(async () => {
    const row = await f.db.get('reply-content')
    return {
      needsTitle: true,
      stream: f.stream,
      agent: {},
      output: { _id: 'reply', role: 'assistant', parts: row!.parts },
      evalResult: { dirty: false },
      requestLog: {},
      messages: [{ role: 'user', content: 'Plan a weekend in Rome.' }],
      resolved: { languageModel: model },
      tools: {
        lookup: tool({
          inputSchema: z.object({}),
          needsApproval,
          execute: async () => 'open',
        }),
      },
    } as unknown as Setup
  })
}

test('queues on the first text step and starts a title request while the turn is open', async () => {
  const f = streamFixture()
  const finalStepStarted = Promise.withResolvers<void>()
  const finishStep = Promise.withResolvers<void>()
  const titleRequested = Promise.withResolvers<void>()
  const respondWithTitle = Promise.withResolvers<void>()
  const { server, requests } = startTitleProvider(async () => {
    titleRequested.resolve()
    await respondWithTitle.promise
  })
  const { action, savedExcerpts } = streamAction(f.ctx, server.url.toString())
  const firstText = 'I’ll look up what is open.'
  const texts = ['', '   ', firstText, 'Here is the full itinerary.']
  let step = 0
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const index = step++
      const last = index === texts.length - 1
      if (last) {
        finalStepStarted.resolve()
        await finishStep.promise
      }
      return { stream: providerStep(index, texts[index], !last) }
    },
  })
  const prepare = stubPreparation(f, model)
  const turn = _stream(action, execution)
  let generating: Promise<string | undefined> | undefined
  try {
    await Promise.race([
      finalStepStarted.promise,
      turn.then(() => {
        throw new Error('Turn ended before the final step')
      }),
    ])
    expect(savedExcerpts).toEqual([undefined, undefined, firstText])
    expect(f.titleJobs()).toHaveLength(1)
    const [job] = f.titleJobs()
    expect(job.args).toEqual({ sessionId, assistantText: firstText })
    await f.db.patch(job._id, { state: { kind: 'inProgress' } })
    generating = generateTitle(
      action,
      job.args as Parameters<typeof generateTitle>[1],
    )
    await Promise.race([
      titleRequested.promise,
      generating.then(() => {
        throw new Error('No title request')
      }),
    ])
    expect(await f.db.get('reply')).toMatchObject({ status: 'processing' })
    expect(requests[0].messages.at(-1)?.content).toBe(
      `User: Plan a weekend in Rome.\nAssistant: ${firstText}`,
    )

    finishStep.resolve()
    await turn
    expect(await f.db.get('reply')).toMatchObject({ status: 'done' })
    expect(f.titleJobs()).toHaveLength(1)
    respondWithTitle.resolve()
    await generating
    expect(await f.db.get(sessionId)).toMatchObject({
      title: 'Un fine settimana romano',
    })
  } finally {
    finishStep.resolve()
    respondWithTitle.resolve()
    await Promise.allSettled([turn, generating])
    prepare.mockRestore()
    await server.stop(true)
  }
})

test('queues the title before the step parks for tool approval', async () => {
  const f = streamFixture()
  const { action } = streamAction(f.ctx)
  const text = 'I need approval to check the museum hours. '.padEnd(
    TITLE_EXCERPT_LENGTH - 1,
    '.',
  )
  const model = new MockLanguageModelV4({
    doStream: async () => ({ stream: providerStep(0, `${text}🏛️`, true) }),
  })
  const prepare = stubPreparation(f, model, true)
  try {
    await _stream(action, execution)
    expect(await f.db.get(execution.streamId)).toMatchObject({
      state: { phase: 'awaiting_approval' },
    })
    expect(f.titleJobs().map((job) => job.args)).toEqual([
      { sessionId, assistantText: text },
    ])
  } finally {
    prepare.mockRestore()
  }
})

test('stop and no-agent fallbacks share the pending job and can retry a failed one', async () => {
  const f = streamFixture()
  const reserved = { ...f.stream, state: { phase: 'reserved' } } as never
  await requestImmediateStop(f.ctx, reserved)
  expect(f.titleJobs()).toHaveLength(1)
  const [job] = f.titleJobs()
  expect(job.args).toEqual({ sessionId })

  const sendWithoutAgent = () =>
    reserveOrDebounceTurn(f.ctx, {
      session: f.session as never,
      messageId: 'user' as never,
      invokedBy: 'owner' as never,
      silent: false,
      activeStream: null,
    })
  await sendWithoutAgent()
  expect(f.titleJobs()).toHaveLength(1)
  await f.db.patch(job._id, {
    state: { kind: 'failed', error: 'fixture failure' },
  })
  await sendWithoutAgent()
  expect(f.titleJobs()).toHaveLength(2)
  expect(await f.db.get(sessionId)).toMatchObject({
    titleGenerationJobId: f.titleJobs()[1]._id,
  })
})
