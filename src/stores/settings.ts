import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { setLocale, getBrowserLocale, SUPPORTED_LOCALES } from '@/locales'
import type { LocalePreference } from '@/locales'
import localforage from 'localforage'

export const useSettingStore = defineStore('settings', () => {
  const locale = ref<LocalePreference>('follow-system')
  // App 内更新检测开关:关闭后不再发起任何版本检查请求
  const updateCheckEnabled = ref(true)

  async function init() {
    const saved = await localforage.getItem<string>('locale')
    if (saved) {
      if (saved === 'follow-system' || (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
        locale.value = saved as LocalePreference
      }
    }
    const savedUpdateCheck = await localforage.getItem<boolean>('updateCheckEnabled')
    if (typeof savedUpdateCheck === 'boolean') {
      updateCheckEnabled.value = savedUpdateCheck
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

  async function setUpdateCheckEnabled(enabled: boolean) {
    updateCheckEnabled.value = enabled
    await localforage.setItem('updateCheckEnabled', enabled)
  }

  watch(locale, () => {
    applyLocale()
  })

  return {
    locale,
    updateCheckEnabled,
    init,
    setLocalePreference,
    setUpdateCheckEnabled,
  }
})
