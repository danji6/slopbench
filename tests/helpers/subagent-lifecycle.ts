export const owner = 'user_1'

export const parentAgent = {
  _id: 'agent_coder',
  ownerId: owner,
  name: 'Coder',
  tools: ['task'],
  subAgents: { mode: 'allow', agentIds: ['agent_explorer'] },
}

export const explorer = {
  _id: 'agent_explorer',
  ownerId: owner,
  name: 'Explore',
}

export function parentDocs(
  parts: unknown[],
  streamFields: Record<string, unknown> = {},
) {
  return [
    {
      sessionId: 'session_1',
      agentId: 'agent_coder',
      invokedBy: owner,
      attempt: 2,
      _id: 'stream_1',
      command: { kind: 'invoke' },
      state: {
        phase: 'streaming',
        processingMessageId: 'message_1',
        processingContentId: 'content_1',
      },
      ...streamFields,
    },
    {
      _id: 'session_1',
      ownerId: owner,
      model: { id: 'parent-model', label: 'Parent Model' },
      reasoningEffort: 'high',
    },
    { _id: 'message_1', selectedVersion: 1 },
    { _id: 'content_1', segmentIndex: 0, version: 1, parts },
    parentAgent,
    explorer,
  ]
}

export const parentApprovals = {
  mode: 'unrestricted' as const,
  shell: ['git checkout'],
}

export function taskPart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool-task',
    toolCallId: 'tc_1',
    state: 'input-available',
    input: { agent_name: 'Explore', prompt: 'Find the config loader' },
    ...overrides,
  }
}

export function reportDocs() {
  return [
    { _id: 'parent_session', ownerId: owner, activeAgentId: 'agent_coder' },
    {
      _id: 'child_session_1',
      title: 'Find config',
      activeAgentId: 'agent_explorer',
      parent: {
        sessionId: 'parent_session',
        streamId: 'parent_stream',
        toolCallId: 'tc_1',
        agentId: 'agent_coder',
      },
    },
    { _id: 'child_message_1', selectedVersion: 1 },
    parentAgent,
    explorer,
  ]
}

export const coderLink = {
  _id: 'link_1',
  sessionId: 'parent_session',
  agentId: 'agent_coder',
}

export const childStream1 = {
  _id: 'child_stream_1',
  sessionId: 'child_session_1',
  agentId: 'agent_explorer',
  invokedBy: owner,
  state: { processingMessageId: 'child_message_1' },
  command: { kind: 'invoke' },
} as never
