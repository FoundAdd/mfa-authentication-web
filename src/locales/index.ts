import { createI18n } from 'vue-i18n'
import en from './en'
import zhCN from './zh-CN'

export type LocaleType = 'zh-CN' | 'en'

const messages = {
  'zh-CN': zhCN,
  'en': en,
}

function getDefaultLocale(): LocaleType {
  const lang = navigator.language
  if (lang.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en'
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