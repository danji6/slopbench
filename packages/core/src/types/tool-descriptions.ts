import { inline } from '../utils/strings'

const web_fetch = 'Fetch a web page and return its main content as markdown.'

const web_search = 'Search the web and return a list of results.'

const read_file =
  'Read a text file. Use this instead of cat/sed for file inspection.'

const write_file = inline`
  Create or overwrite a text file in the configured coding workspace.
  Prefer edit_file for targeted changes.`

const edit_file = inline`
  Edit a text file using exact, unique replacements. Pass the changes as
  \`edits: [{ oldText, newText }]\` (array of objects). Use one call with
  multiple edits for parallel changes in the same file. Keep oldText small but
  unique; include surrounding context if there are multiple occurrences. Merge
  nearby or overlapping changes into one edit.`

const shell = inline`
  Run a (bash) shell command in the workspace. Set run_in_background for
  long-running commands and read them later with shell_output.`

const shell_output = inline`
  Read output from a shell job started with run_in_background. Waits up to
  wait_seconds (default 30) for the job to finish.`

const kill_shell = 'Kill a running shell job.'

const write_plan = inline`
  Create or overwrite the session plan. Use it for the initial draft or a
  complete rewrite; prefer edit_plan for targeted changes.`

const edit_plan = inline`
  Edit the session plan using exact, unique replacements. Pass the changes as
  \`edits: [{ oldText, newText }]\` (array of objects). Use one call with
  multiple edits for parallel changes in different places.`

const enter_plan_mode = inline`
  Enter plan mode. Use this when the task is large or ambiguous enough that
  researching and agreeing on a plan first would help.`

const exit_plan_mode = inline`
  Present the current plan for user approval. Call this once the plan is
  complete.`

const write_todo = inline`
  Create or replace the session todo list. Use it for substantial tasks of 3+
  steps. Tasks matching existing ones keep their status; an empty list clears
  the list. Update statuses with edit_todo.`

const edit_todo = inline`
  Update todo statuses. Each edit names the exact text of an existing task and
  its new status. Mark a task 'doing' before starting it (one at a time) and
  'done' immediately when finished; never batch completions.`

const task = [
  inline`
    Delegate a task to a sub-agent that works in its own separate session in the
    background. This call returns immediately with an acknowledgment; the
    sub-agent keeps working and its final report arrives later as a separate
    message in this conversation. You can keep working meanwhile. To wait for a
    report, simply stop responding to the user and end your turn.`,
  '',
  inline`
    Use tasks for research or self-contained subtasks to keep this conversation
    focused, and call it multiple times in one turn to run sub-agents in
    parallel. The sub-agent starts fresh, it sees only your prompt and cannot
    ask the user or you anything. Write a complete, specific prompt and state
    exactly what the final report should contain.`,
].join('\n')

export const TOOL_DESCRIPTIONS = {
  web_fetch,
  web_search,
  read_file,
  write_file,
  edit_file,
  shell,
  shell_output,
  kill_shell,
  write_plan,
  edit_plan,
  enter_plan_mode,
  exit_plan_mode,
  write_todo,
  edit_todo,
  task,
} as const
