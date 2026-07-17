/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_agents from "../actions/agents.js";
import type * as actions_io_agent from "../actions/io/agent.js";
import type * as actions_io_avatar from "../actions/io/avatar.js";
import type * as actions_mcp from "../actions/mcp.js";
import type * as actions_messages from "../actions/messages.js";
import type * as actions_session_archive from "../actions/session/archive.js";
import type * as actions_session_title from "../actions/session/title.js";
import type * as actions_session_workspace from "../actions/session/workspace.js";
import type * as actions_sessions from "../actions/sessions.js";
import type * as actions_stream_engine from "../actions/stream/engine.js";
import type * as actions_stream_evalContext from "../actions/stream/evalContext.js";
import type * as actions_stream_evalMessage from "../actions/stream/evalMessage.js";
import type * as actions_stream_history from "../actions/stream/history.js";
import type * as actions_stream_operations from "../actions/stream/operations.js";
import type * as actions_streams from "../actions/streams.js";
import type * as actions_terminals from "../actions/terminals.js";
import type * as actions_tool_terminal from "../actions/tool/terminal.js";
import type * as actions_workspaces from "../actions/workspaces.js";
import type * as agents from "../agents.js";
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as avatars from "../avatars.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as editorScripts from "../editorScripts.js";
import type * as errors from "../errors.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as lib_roles from "../lib/roles.js";
import type * as lib_subagent from "../lib/subagent.js";
import type * as lib_tool_approval from "../lib/tool/approval.js";
import type * as lib_tool_read_only_args from "../lib/tool/read_only_args.js";
import type * as lib_utils from "../lib/utils.js";
import type * as lib_workspace from "../lib/workspace.js";
import type * as migrations from "../migrations.js";
import type * as model_agent_archive from "../model/agent/archive.js";
import type * as model_agent_subagents from "../model/agent/subagents.js";
import type * as model_agents from "../model/agents.js";
import type * as model_attachments from "../model/attachments.js";
import type * as model_avatars from "../model/avatars.js";
import type * as model_chat_approvals from "../model/chat/approvals.js";
import type * as model_chat_controls from "../model/chat/controls.js";
import type * as model_chat_eval from "../model/chat/eval.js";
import type * as model_chat_identities from "../model/chat/identities.js";
import type * as model_chat_index from "../model/chat/index.js";
import type * as model_chat_mutations from "../model/chat/mutations.js";
import type * as model_chat_queries from "../model/chat/queries.js";
import type * as model_chat_reminders from "../model/chat/reminders.js";
import type * as model_chat_reserve from "../model/chat/reserve.js";
import type * as model_chat_retry from "../model/chat/retry.js";
import type * as model_chat_send from "../model/chat/send.js";
import type * as model_chat_starters from "../model/chat/starters.js";
import type * as model_context from "../model/context.js";
import type * as model_defaults from "../model/defaults.js";
import type * as model_editorScripts from "../model/editorScripts.js";
import type * as model_io_base64 from "../model/io/base64.js";
import type * as model_messageContents from "../model/messageContents.js";
import type * as model_messages from "../model/messages.js";
import type * as model_plans from "../model/plans.js";
import type * as model_prompt_dynamic from "../model/prompt/dynamic.js";
import type * as model_prompt_markers from "../model/prompt/markers.js";
import type * as model_prompt_merge from "../model/prompt/merge.js";
import type * as model_prompt_prompts from "../model/prompt/prompts.js";
import type * as model_provider_known from "../model/provider/known.js";
import type * as model_provider_options from "../model/provider/options.js";
import type * as model_provider_providers from "../model/provider/providers.js";
import type * as model_session_agents from "../model/session/agents.js";
import type * as model_session_archive from "../model/session/archive.js";
import type * as model_session_memberships from "../model/session/memberships.js";
import type * as model_session_metadata from "../model/session/metadata.js";
import type * as model_session_sessions from "../model/session/sessions.js";
import type * as model_session_shares from "../model/session/shares.js";
import type * as model_session_title from "../model/session/title.js";
import type * as model_session_workspace from "../model/session/workspace.js";
import type * as model_settings from "../model/settings.js";
import type * as model_sidecar from "../model/sidecar.js";
import type * as model_stream_generatedFiles from "../model/stream/generatedFiles.js";
import type * as model_stream_lifecycle from "../model/stream/lifecycle.js";
import type * as model_stream_reads from "../model/stream/reads.js";
import type * as model_stream_retry from "../model/stream/retry.js";
import type * as model_stream_subagents from "../model/stream/subagents.js";
import type * as model_stream_toolOutput from "../model/stream/toolOutput.js";
import type * as model_stream_transformers from "../model/stream/transformers.js";
import type * as model_stream_usage from "../model/stream/usage.js";
import type * as model_subagent_manage from "../model/subagent/manage.js";
import type * as model_subagent_usage from "../model/subagent/usage.js";
import type * as model_subagent_watch from "../model/subagent/watch.js";
import type * as model_todos from "../model/todos.js";
import type * as model_tool_repair from "../model/tool/repair.js";
import type * as model_tool_shell from "../model/tool/shell.js";
import type * as model_tools from "../model/tools.js";
import type * as model_typing from "../model/typing.js";
import type * as model_userSessions from "../model/userSessions.js";
import type * as model_users from "../model/users.js";
import type * as models from "../models.js";
import type * as plans from "../plans.js";
import type * as sessionAgents from "../sessionAgents.js";
import type * as sessionShares from "../sessionShares.js";
import type * as sessions from "../sessions.js";
import type * as settings from "../settings.js";
import type * as streams from "../streams.js";
import type * as subagents from "../subagents.js";
import type * as todos from "../todos.js";
import type * as tools from "../tools.js";
import type * as types from "../types.js";
import type * as typing from "../typing.js";
import type * as userSessions from "../userSessions.js";
import type * as users from "../users.js";
import type * as validators_args from "../validators/args.js";
import type * as validators_index from "../validators/index.js";
import type * as validators_sub from "../validators/sub.js";
import type * as validators_tables from "../validators/tables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/agents": typeof actions_agents;
  "actions/io/agent": typeof actions_io_agent;
  "actions/io/avatar": typeof actions_io_avatar;
  "actions/mcp": typeof actions_mcp;
  "actions/messages": typeof actions_messages;
  "actions/session/archive": typeof actions_session_archive;
  "actions/session/title": typeof actions_session_title;
  "actions/session/workspace": typeof actions_session_workspace;
  "actions/sessions": typeof actions_sessions;
  "actions/stream/engine": typeof actions_stream_engine;
  "actions/stream/evalContext": typeof actions_stream_evalContext;
  "actions/stream/evalMessage": typeof actions_stream_evalMessage;
  "actions/stream/history": typeof actions_stream_history;
  "actions/stream/operations": typeof actions_stream_operations;
  "actions/streams": typeof actions_streams;
  "actions/terminals": typeof actions_terminals;
  "actions/tool/terminal": typeof actions_tool_terminal;
  "actions/workspaces": typeof actions_workspaces;
  agents: typeof agents;
  attachments: typeof attachments;
  auth: typeof auth;
  avatars: typeof avatars;
  chat: typeof chat;
  crons: typeof crons;
  editorScripts: typeof editorScripts;
  errors: typeof errors;
  functions: typeof functions;
  http: typeof http;
  "lib/roles": typeof lib_roles;
  "lib/subagent": typeof lib_subagent;
  "lib/tool/approval": typeof lib_tool_approval;
  "lib/tool/read_only_args": typeof lib_tool_read_only_args;
  "lib/utils": typeof lib_utils;
  "lib/workspace": typeof lib_workspace;
  migrations: typeof migrations;
  "model/agent/archive": typeof model_agent_archive;
  "model/agent/subagents": typeof model_agent_subagents;
  "model/agents": typeof model_agents;
  "model/attachments": typeof model_attachments;
  "model/avatars": typeof model_avatars;
  "model/chat/approvals": typeof model_chat_approvals;
  "model/chat/controls": typeof model_chat_controls;
  "model/chat/eval": typeof model_chat_eval;
  "model/chat/identities": typeof model_chat_identities;
  "model/chat/index": typeof model_chat_index;
  "model/chat/mutations": typeof model_chat_mutations;
  "model/chat/queries": typeof model_chat_queries;
  "model/chat/reminders": typeof model_chat_reminders;
  "model/chat/reserve": typeof model_chat_reserve;
  "model/chat/retry": typeof model_chat_retry;
  "model/chat/send": typeof model_chat_send;
  "model/chat/starters": typeof model_chat_starters;
  "model/context": typeof model_context;
  "model/defaults": typeof model_defaults;
  "model/editorScripts": typeof model_editorScripts;
  "model/io/base64": typeof model_io_base64;
  "model/messageContents": typeof model_messageContents;
  "model/messages": typeof model_messages;
  "model/plans": typeof model_plans;
  "model/prompt/dynamic": typeof model_prompt_dynamic;
  "model/prompt/markers": typeof model_prompt_markers;
  "model/prompt/merge": typeof model_prompt_merge;
  "model/prompt/prompts": typeof model_prompt_prompts;
  "model/provider/known": typeof model_provider_known;
  "model/provider/options": typeof model_provider_options;
  "model/provider/providers": typeof model_provider_providers;
  "model/session/agents": typeof model_session_agents;
  "model/session/archive": typeof model_session_archive;
  "model/session/memberships": typeof model_session_memberships;
  "model/session/metadata": typeof model_session_metadata;
  "model/session/sessions": typeof model_session_sessions;
  "model/session/shares": typeof model_session_shares;
  "model/session/title": typeof model_session_title;
  "model/session/workspace": typeof model_session_workspace;
  "model/settings": typeof model_settings;
  "model/sidecar": typeof model_sidecar;
  "model/stream/generatedFiles": typeof model_stream_generatedFiles;
  "model/stream/lifecycle": typeof model_stream_lifecycle;
  "model/stream/reads": typeof model_stream_reads;
  "model/stream/retry": typeof model_stream_retry;
  "model/stream/subagents": typeof model_stream_subagents;
  "model/stream/toolOutput": typeof model_stream_toolOutput;
  "model/stream/transformers": typeof model_stream_transformers;
  "model/stream/usage": typeof model_stream_usage;
  "model/subagent/manage": typeof model_subagent_manage;
  "model/subagent/usage": typeof model_subagent_usage;
  "model/subagent/watch": typeof model_subagent_watch;
  "model/todos": typeof model_todos;
  "model/tool/repair": typeof model_tool_repair;
  "model/tool/shell": typeof model_tool_shell;
  "model/tools": typeof model_tools;
  "model/typing": typeof model_typing;
  "model/userSessions": typeof model_userSessions;
  "model/users": typeof model_users;
  models: typeof models;
  plans: typeof plans;
  sessionAgents: typeof sessionAgents;
  sessionShares: typeof sessionShares;
  sessions: typeof sessions;
  settings: typeof settings;
  streams: typeof streams;
  subagents: typeof subagents;
  todos: typeof todos;
  tools: typeof tools;
  types: typeof types;
  typing: typeof typing;
  userSessions: typeof userSessions;
  users: typeof users;
  "validators/args": typeof validators_args;
  "validators/index": typeof validators_index;
  "validators/sub": typeof validators_sub;
  "validators/tables": typeof validators_tables;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
