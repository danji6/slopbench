import type { ThemeRegistration } from 'shiki'

export const themeName = 'material-you'

export const theme: ThemeRegistration = {
  name: themeName,
  type: 'dark', // Type doesn't matter much when using CSS vars, but 'dark' is a safe default
  colors: {
    // Base colors
    'editor.background': 'var(--m3-surface-container-low)',
    'editor.foreground': 'var(--m3-on-surface)',
    'editorCursor.foreground': 'var(--m3-primary)',
    'editor.selectionBackground': 'var(--m3-secondary-container)',
    'editor.lineHighlightBackground': 'var(--m3-surface-container-high)',

    // UI colors
    'activityBar.background': 'var(--m3-surface)',
    'sideBar.background': 'var(--m3-surface)',
    'statusBar.background': 'var(--m3-surface-container)',
  },
  settings: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: {
        foreground: 'var(--m3-outline)',
        fontStyle: 'italic',
      },
    },
    {
      scope: ['string', 'constant.character.escape'],
      settings: {
        foreground: 'var(--shiki-green)',
      },
    },
    {
      scope: [
        'constant.numeric',
        'variable.other.constant',
        'entity.name.constant',
        'constant.language.boolean',
        'constant.language.false',
        'constant.language.true',
        'support.constant.property-value',
        'support.constant.font-name',
        'support.constant.media-type',
        'support.constant.media',
        'constant.other.color.rgb-value',
        'constant.other.rgb-value',
        'constant.other.color',
      ],
      settings: {
        foreground: 'var(--shiki-orange)',
      },
    },
    {
      scope: [
        'keyword',
        'keyword.control',
        'keyword.operator.word',
        'keyword.operator.new',
        'variable.language.super',
        'support.type.primitive',
        'storage.type',
        'storage.modifier',
      ],
      settings: {
        foreground: 'var(--shiki-purple)',
      },
    },
    {
      scope: ['entity.name.tag.documentation'],
      settings: {
        foreground: 'var(--shiki-purple)',
      },
    },
    {
      scope: [
        'punctuation',
        'keyword.operator',
        'punctuation.accessor',
        'punctuation.definition.generic',
        'meta.function.closure punctuation.section.parameters',
        'punctuation.definition.tag',
        'punctuation.separator.key-value',
      ],
      settings: {
        foreground: 'var(--m3-outline)',
      },
    },
    {
      scope: [
        'entity.name.function',
        'meta.function-call.method',
        'support.function',
        'support.function.misc',
        'variable.function',
      ],
      settings: {
        foreground: 'var(--shiki-blue)',
        fontStyle: 'italic',
      },
    },
    {
      scope: [
        'entity.name.class',
        'entity.other.inherited-class',
        'support.class',
        'meta.function-call.constructor',
        'entity.name.struct',
        'entity.other.attribute-name',
        'entity.other.attribute-name.class',
        'entity.other.attribute-name.id',
      ],
      settings: {
        foreground: 'var(--shiki-yellow)',
        fontStyle: 'italic',
      },
    },
    {
      scope: 'variable',
      settings: {
        foreground: 'var(--shiki-fg)',
      },
    },
    {
      scope: ['variable.parameter', 'support.type.property-name'],
      settings: {
        foreground: 'var(--shiki-cyan)',
      },
    },
    {
      scope: ['entity.name.tag', 'meta.tag.sgml', 'markup.deleted.git_gutter'],
      settings: {
        foreground: 'var(--shiki-red)',
      },
    },
  ],
}
