import { describe, it, expect } from 'vitest'
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAMES } from './index'
import en from './en'
import zhCN from './zh-CN'
import ja from './ja'
import ko from './ko'
import de from './de'
import fr from './fr'
import itLocale from './it'
import es from './es'
import ru from './ru'
import pt from './pt'
import nl from './nl'
import ar from './ar'

const messages: Record<string, unknown> = {
  'zh-CN': zhCN,
  'en': en,
  'ja': ja,
  'ko': ko,
  'de': de,
  'fr': fr,
  'it': itLocale,
  'es': es,
  'ru': ru,
  'pt': pt,
  'nl': nl,
  'ar': ar,
}

function flattenLeaves(node: unknown, prefix = ''): Record<string, string> {
  const leaves: Record<string, string> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      Object.assign(leaves, flattenLeaves(value, path))
    } else {
      leaves[path] = String(value)
    }
  }
  return leaves
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

describe('locales', () => {
  it('每个支持的语言都有语言包且键结构与 en 完全一致', () => {
    const enLeaves = flattenLeaves(en)
    for (const locale of SUPPORTED_LOCALES) {
      const msgs = messages[locale]
      expect(msgs, `缺少语言包: ${locale}`).toBeDefined()
      const leaves = flattenLeaves(msgs)
      expect(Object.keys(leaves).sort(), `${locale} 键不一致`).toEqual(
        Object.keys(enLeaves).sort(),
      )
      for (const [key, value] of Object.entries(leaves)) {
        expect(value.trim(), `${locale}.${key} 为空`).not.toBe('')
      }
    }
  })

  it('每个键的插值占位符与 en 一致', () => {
    const enLeaves = flattenLeaves(en)
    for (const locale of SUPPORTED_LOCALES) {
      const leaves = flattenLeaves(messages[locale])
      for (const [key, value] of Object.entries(leaves)) {
        expect(placeholders(value), `${locale}.${key} 占位符不一致`).toEqual(
          placeholders(enLeaves[key]),
        )
      }
    }
  })

  it('每个支持的语言都有母语显示名', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_NATIVE_NAMES[locale], `${locale} 缺少显示名`).toBeTruthy()
    }
  })
})
