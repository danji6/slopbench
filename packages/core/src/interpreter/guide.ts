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

const fence = '` $``` `'

export const PROMPT_CONTENT_GUIDE = `
You can write JavaScript code in the content of your prompts. Code is evaluated
before sending a message and the output replaces the block itself. This is
useful when you want to inject dynamic values into your prompts, like the
current user's name, or values from previous messages.

To write a dynamic code block, type \`$\` followed by three backticks (${fence}):

\`\`\`js
function calculate() { ... }

// Get a value from the current session:
let value = getVar('myValue')

if (!value) {
  // Store a value in the current session:
  value = calculate()
  setVar('myValue', value)
}

return \`The result is \${value}\`
\`\`\`

Alternatively you can write inline code by wrapping your expression within
double curly braces:
\`{{user ?? 'Bob'}}\`

**Conditional blocks**

You can conditionally include or exclude parts of a prompt with \`#if\`
directives. Each directive must be on its own line:

\`\`\`
You are a helpful assistant.
#if userCount > 1
Multiple people are here, be concise and address everyone.
#elif isAdmin
The single participant is an admin.
#else
Standard single-user instructions.
#endif
\`\`\`

The condition after \`#if\`/\`#elif\` can be a single-line expression (as above)
or a full dynamic block when you need more logic:

\`\`\`\`
#if $\`\`\`
const flag = getVar('featureFlag')
return flag && userCount > 1
\`\`\`
Instructions shown only when the flag is set and more than one user is present.
#endif
\`\`\`\`

Blocks can be nested, and an \`#if\` without a matching \`#endif\` automatically
closes at the end of the prompt. If a condition throws or fails to compile, that
branch is silently treated as false and its content is dropped.

Note: a directive starts with \`#if\`/\`#elif\`/\`#else\`/\`#endif\` immediately
after \`#\`, with no space. A Markdown heading uses a space (\`# My heading\`),
so \`# if ...\` is a heading while \`#if ...\` is a directive.

**Variables**

| Name | Description |
|------|-------------|
${variableRows}

**Functions**

${functionSections}
`.trim()
