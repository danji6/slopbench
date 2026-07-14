import js from '@eslint/js'
import betterTailwind from 'eslint-plugin-better-tailwindcss'
import reactHooks from 'eslint-plugin-react-hooks'
import unusedImports from 'eslint-plugin-unused-imports'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  {
    ignores: [
      'scripts/misc',
      '.data*',
      '.next',
      'vitest.config.cjs',
      'node_modules',
      'dist',
      'build',
      'packages/client/dist',
      'packages/client/src/tests',
      'packages/convex/src/_generated',
      'packages/client/public/assets',
      'packages/client/public/code-examples',
      'tmp',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  reactHooks.configs.flat.recommended,

  {
    plugins: {
      'unused-imports': unusedImports,
      'better-tailwindcss': betterTailwind,
    },

    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],

      'better-tailwindcss/enforce-consistent-class-order': 'warn',
      'better-tailwindcss/no-duplicate-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
    },

    settings: {
      tailwindcss: {
        callees: ['cn', 'clsx', 'cva'],
        config: 'tailwind.config.ts',
      },
    },
  },
)
