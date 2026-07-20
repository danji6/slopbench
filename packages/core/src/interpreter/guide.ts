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
You can write JavaScript code in the content of your prompts. Code is evaluated before sending a
message and the output replaces the block itself. This is useful when you want to inject dynamic
values into your prompts, like the current user's name, or values from previous messages.

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

Alternatively you can write inline code by wrapping your expression within double curly braces:
\`{{user ?? 'Bob'}}\`

**Variables**

| Name | Description |
|------|-------------|
${variableRows}

**Functions**

${functionSections}
`.trim()
