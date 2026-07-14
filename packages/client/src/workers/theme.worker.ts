import {
  exportSchemeCss,
  sourceColorFromBitmap,
  sourceColorFromBytes,
} from '@/lib/theme'
import { expose } from 'comlink'

expose({
  sourceColorFromBytes,
  sourceColorFromBitmap,
  exportSchemeCss,
})
