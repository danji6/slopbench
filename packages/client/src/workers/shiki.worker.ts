import { runDiffHighlighter, runHighlighter } from '@/lib/shiki/core'
import { expose } from 'comlink'

const api = {
  highlight: runHighlighter,
  highlightDiff: runDiffHighlighter,
}

expose(api)
