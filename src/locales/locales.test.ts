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

// en 与 zh-CN 是完整维护的基准语言;其余语言允许暂时缺失条目,
// 缺失的条目由 vue-i18n 的 fallbackLocale: 'en' 回退为英文显示
const BASE_LOCALES = ['en', 'zh-CN'] as const

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
  it('基准语言 en 与 zh-CN 键结构完全一致且无空条目', () => {
    const enKeys = Object.keys(flattenLeaves(en)).sort()
    expect(enKeys.length, '基准语言 en 不能为空').toBeGreaterThan(0)
    for (const locale of BASE_LOCALES) {
      const leaves = flattenLeaves(messages[locale])
      expect(Object.keys(leaves).sort(), `${locale} 键与 en 不一致`).toEqual(enKeys)
      for (const [key, value] of Object.entries(leaves)) {
        expect(value.trim(), `${locale}.${key} 为空`).not.toBe('')
      }
    }
  })

  it('其余语言是 en 的子集,不允许出现 en 没有的键', () => {
    const enKeys = new Set(Object.keys(flattenLeaves(en)))
    for (const locale of SUPPORTED_LOCALES) {
      if ((BASE_LOCALES as readonly string[]).includes(locale)) continue
      const msgs = messages[locale]
      expect(msgs, `缺少语言包: ${locale}`).toBeDefined()
      for (const key of Object.keys(flattenLeaves(msgs))) {
        expect(enKeys.has(key), `${locale} 含 en 中不存在的键 ${key}`).toBe(true)
      }
    }
  })

  it('已有条目不为空且插值占位符与 en 一致(缺失条目回退 en)', () => {
    const enLeaves = flattenLeaves(en)
    for (const locale of SUPPORTED_LOCALES) {
      const leaves = flattenLeaves(messages[locale])
      for (const [key, value] of Object.entries(leaves)) {
        expect(value.trim(), `${locale}.${key} 为空`).not.toBe('')
        expect(placeholders(value), `${locale}.${key} 占位符与 en 不一致`).toEqual(
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
