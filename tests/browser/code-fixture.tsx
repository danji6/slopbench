import { Code } from '@/components/ui/code'
import '@/globals.css'

const suffix = ' '.repeat(2) + 'long expression + '.repeat(25)
const code = Array.from(
  { length: 12 },
  (_, index) => `const value${index} = "unchanged";${suffix}`,
).join('\n')
const diff = `--- file.ts\n+++ file.ts\n@@ -1,12 +1,12 @@\n-const theme = "dark";${suffix}\n+const theme = "light";${suffix}\n${code
  .split('\n')
  .slice(1)
  .map((line) => ` ${line}`)
  .join('\n')}`

export function CodeFixture() {
  const highlighting =
    new URLSearchParams(location.search).get('highlighting') !== 'off'
  return (
    <main className="mx-auto w-90 max-w-full space-y-4 p-4">
      <Code
        data-testid="numbered"
        text={code}
        lineNumbers
        highlighting={highlighting}
        noCopyButton
        hugParent
        innerClassName="max-h-40"
      />
      <Code
        data-testid="diff"
        text={diff}
        diff
        highlighting={highlighting}
        noCopyButton
        hugParent
        innerClassName="max-h-40"
      />
      <Code
        data-testid="wrapped"
        text={code}
        lineNumbers
        wordWrap
        highlighting={highlighting}
        noCopyButton
        hugParent
        innerClassName="max-h-40"
      />
    </main>
  )
}
