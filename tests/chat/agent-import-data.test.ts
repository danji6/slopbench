import {
  agentArchiveToCreateArgs,
  createAgentArchive,
} from '@sb/convex/model/agent/archive'
import { describe, expect, test } from 'bun:test'

describe('agent import data normalization', () => {
  test('exports canonical versioned agent archives', () => {
    const archive = createAgentArchive(
      {
        name: 'Assistant',
        prompts: [
          {
            id: 'history',
            name: 'Message History',
            type: 'message-history',
          },
        ],
      },
      [],
      123,
    )

    expect(archive).toEqual({
      version: 1,
      exportedAt: 123,
      agent: {
        name: 'Assistant',
        prompts: [
          {
            id: 'history',
            type: 'message-history',
          },
        ],
        tools: undefined,
        globalPromptsEnabled: undefined,
        promptOrder: undefined,
        modelId: undefined,
        reasoningEffort: undefined,
        temperature: undefined,
        topP: undefined,
        frequencyPenalty: undefined,
        presencePenalty: undefined,
        repeatPenalty: undefined,
        trimContext: undefined,
        contextWindow: undefined,
        outputTokens: undefined,
        shareUserDisplayNames: undefined,
        shareAgentDisplayNames: undefined,
        maskOtherAgents: undefined,
        customCss: undefined,
        scrollMode: undefined,
        theme: undefined,
      },
    })
  })

  test('strips display fields from prompt markers', () => {
    const data = agentArchiveToCreateArgs({
      name: 'Assistant',
      prompts: [
        {
          id: 'history',
          name: 'Message History',
          type: 'message-history',
        },
      ],
    })

    expect(data.prompts).toEqual([
      {
        id: 'history',
        type: 'message-history',
      },
    ])
  })

  test('defaults partial prompt exports into valid prompt items', () => {
    const data = agentArchiveToCreateArgs({
      name: 'Assistant',
      prompts: [
        {
          id: 'prompt',
          content: 'Imported prompt',
        },
      ],
    })

    expect(data.prompts).toEqual([
      {
        id: 'prompt',
        name: 'System',
        role: 'system',
        content: 'Imported prompt',
        enabled: true,
        visible: false,
        starter: false,
      },
    ])
  })

  test('filters invalid validated fields from loose export data', () => {
    const data = agentArchiveToCreateArgs({
      name: 'Assistant',
      prompts: [],
      promptOrder: [
        { kind: 'own', id: 'prompt' },
        { kind: 'unknown', id: 'bad' },
        { kind: 'global' },
      ],
      scrollMode: 'invalid',
      theme: { source: 'invalid', light: {}, dark: { color: 1 } },
    })

    expect(data.promptOrder).toEqual([{ kind: 'own', id: 'prompt' }])
    expect(data.scrollMode).toBeUndefined()
    expect(data.theme).toBeUndefined()
  })

  test('imports current archive versions through the migration path', () => {
    const data = agentArchiveToCreateArgs({
      version: 1,
      exportedAt: 123,
      agent: {
        name: 'Assistant',
        prompts: [
          {
            id: 'prompt',
            name: 'Task',
            role: 'user',
            content: 'Imported prompt',
            enabled: true,
            visible: true,
            starter: false,
            futureField: 'ignored',
          },
        ],
        futureField: 'ignored',
      },
    })

    expect(data.prompts).toEqual([
      {
        id: 'prompt',
        name: 'Task',
        role: 'user',
        content: 'Imported prompt',
        enabled: true,
        visible: true,
        starter: false,
      },
    ])
  })

  test('rejects unsupported future archive versions explicitly', () => {
    expect(() =>
      agentArchiveToCreateArgs({
        version: 2,
        exportedAt: 123,
        agent: {
          name: 'Assistant',
          prompts: [],
        },
      }),
    ).toThrow('Unsupported agent archive version: 2')
  })
})
