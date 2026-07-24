import {
  SESSION_ENV,
  type SessionEnvEntry,
  type SessionEnvParam,
  isEnvFunction,
} from './env'

const paramSignature = (param: SessionEnvParam) =>
  `${param.name}${param.optional ? '?' : ''}`

const functionSignature = (entry: SessionEnvEntry) =>
  `${entry.name}(${(entry.params ?? []).map(paramSignature).join(', ')})`

const variableRows = SESSION_ENV.filter((entry) => !isEnvFunction(entry))
  .map((entry) => `| \`${entry.name}\` | ${entry.description} |`)
  .join('\n')

const functionSections = SESSION_ENV.filter(isEnvFunction)
  .map((entry) => {
    const params = (entry.params ?? [])
      .map((param) => `- \`${paramSignature(param)}\` — ${param.description}`)
      .join('\n')
    return `\`${functionSignature(entry)}\`\n\n${entry.description}\n\n${params}`
  })
  .join('\n\n')

export const PROMPT_CONTENT_GUIDE = `
You can write JavaScript code in the content of your prompts. Code is evaluated
before sending a message and the output replaces the block itself. This is
useful when you want to inject dynamic values into your prompts, like the
current user's name, or values from previous messages.

To write a dynamic code block, open it with \`#eval\` and close it with \`#end\`:

\`\`\`js
#eval
// Get a value from the current session:
let value = getVar('myValue')

if (!value) {
  // Store a value in the current session:
  value = calculate()
  setVar('myValue', value)
}

return \`The result is \${value}\`
#end
\`\`\`

Alternatively you can write inline code by wrapping your expression within double
curly braces:
\`{{user ?? 'Bob'}}\`

**Conditional blocks**

You can conditionally include or exclude parts of a prompt with \`#if\`
directives:

\`\`\`js
You are a helpful assistant.
#if userCount > 1
Multiple people are here, be concise and address everyone.
#elif isAdmin
The single participant is an admin.
#else
Standard single-user instructions.
#endif
\`\`\`

The condition after \`#if\`/\`#elif\` is an inline expression. When you need
more logic, you can open a multiline \`#if\` with a \`#then\` as follows:

\`\`\`js
#if
const flag = getVar('featureFlag')
return flag && userCount > 1
#then
Instructions shown only when the flag is set and more than one user is present.
#endif
\`\`\`

Blocks can be nested, and an \`#if\` without a matching \`#endif\` spans the
rest of the prompt. Errors are silently treated as false and the content is
dropped.

**Variables**

| Name | Description |
|------|-------------|
${variableRows}

**Functions**

${functionSections}
`.trim()
