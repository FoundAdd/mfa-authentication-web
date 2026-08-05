import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { setLocale, getBrowserLocale } from '@/locales'
import type { LocaleType } from '@/locales'
import localforage from 'localforage'

export const useSettingStore = defineStore('settings', () => {
  const locale = ref<LocaleType | 'follow-system'>('follow-system')

  async function init() {
    const saved = await localforage.getItem<string>('locale')
    if (saved) {
      if (saved === 'follow-system' || saved === 'zh-CN' || saved === 'en') {
        locale.value = saved as LocaleType | 'follow-system'
      }
    }
    applyLocale()
  }

  function applyLocale() {
    if (locale.value === 'follow-system') {
      setLocale(getBrowserLocale())
    } else {
      setLocale(locale.value)
    }
  }

  async function setLocalePreference(localePreference: LocaleType | 'follow-system') {
    locale.value = localePreference
    await localforage.setItem('locale', localePreference)
    applyLocale()
  }

  watch(locale, () => {
    applyLocale()
  })

  return {
    locale,
    init,
    setLocalePreference,
  }
})