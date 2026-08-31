import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { setLocale, getBrowserLocale, SUPPORTED_LOCALES } from '@/locales'
import type { LocalePreference } from '@/locales'
import localforage from 'localforage'

export const useSettingStore = defineStore('settings', () => {
  const locale = ref<LocalePreference>('follow-system')

  async function init() {
    const saved = await localforage.getItem<string>('locale')
    if (saved) {
      if (saved === 'follow-system' || (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
        locale.value = saved as LocalePreference
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

  async function setLocalePreference(localePreference: LocalePreference) {
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
