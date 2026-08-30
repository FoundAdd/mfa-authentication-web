import { createI18n } from 'vue-i18n'
import en from './en'
import zhCN from './zh-CN'
import ja from './ja'
import ko from './ko'
import de from './de'
import fr from './fr'
import it from './it'
import es from './es'
import ru from './ru'
import pt from './pt'
import nl from './nl'
import ar from './ar'

export const SUPPORTED_LOCALES = [
  'zh-CN',
  'en',
  'ja',
  'ko',
  'de',
  'fr',
  'it',
  'es',
  'ru',
  'pt',
  'nl',
  'ar',
] as const

export type LocaleType = (typeof SUPPORTED_LOCALES)[number]

export type LocalePreference = LocaleType | 'follow-system'

const messages = {
  'zh-CN': zhCN,
  'en': en,
  'ja': ja,
  'ko': ko,
  'de': de,
  'fr': fr,
  'it': it,
  'es': es,
  'ru': ru,
  'pt': pt,
  'nl': nl,
  'ar': ar,
}

// 语言名称始终以各自母语展示，不随界面语言翻译
export const LOCALE_NATIVE_NAMES: Record<LocaleType, string> = {
  'zh-CN': '简体中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
  'de': 'Deutsch',
  'fr': 'Français',
  'it': 'Italiano',
  'es': 'Español',
  'ru': 'Русский',
  'pt': 'Português',
  'nl': 'Nederlands',
  'ar': 'العربية',
}

function isSupportedLocale(value: string): value is LocaleType {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function getDefaultLocale(): LocaleType {
  const lang = navigator.language.toLowerCase()
  if (isSupportedLocale(lang)) {
    return lang
  }
  const primary = lang.split('-')[0]
  const matched = SUPPORTED_LOCALES.find(
    (locale) => locale.toLowerCase().split('-')[0] === primary,
  )
  return matched ?? 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'en',
  messages,
})

export function setLocale(locale: LocaleType) {
  i18n.global.locale.value = locale
}

export function getBrowserLocale(): LocaleType {
  return getDefaultLocale()
}
