import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { setLocale, getBrowserLocale, SUPPORTED_LOCALES } from '@/locales'
import type { LocalePreference } from '@/locales'
import { isNativePlatform } from '@/utils/capacitor'
import { syncNativeStatusBar } from '@/services/themeNative'
import localforage from 'localforage'

export type ThemePreference = 'follow-system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const THEME_PREFERENCES: readonly ThemePreference[] = [
  'follow-system',
  'light',
  'dark',
]
// localStorage 镜像键:index.html 内联脚本在首帧前同步读取,避免闪色
const THEME_MIRROR_KEY = 'app-theme'
// 浏览器/PWA 的 theme-color meta 颜色(原生状态栏背景由 WebView 透明状态栏透出)
const THEME_META_COLORS: Record<ResolvedTheme, string> = {
  light: '#f5f5f5',
  dark: '#0a0a0a',
}

function getSystemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => onChange(e.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  } catch {
    return () => {}
  }
}

export const useSettingStore = defineStore('settings', () => {
  const locale = ref<LocalePreference>('follow-system')
  // App 内更新检测开关:关闭后不再发起任何版本检查请求
  const updateCheckEnabled = ref(true)
  const theme = ref<ThemePreference>('follow-system')
  const systemPrefersDark = ref(getSystemPrefersDark())
  const resolvedTheme = computed<ResolvedTheme>(() => {
    if (theme.value === 'follow-system') {
      return systemPrefersDark.value ? 'dark' : 'light'
    }
    return theme.value
  })

  function applyTheme() {
    const dark = resolvedTheme.value === 'dark'
    document.documentElement.classList.toggle('dark', dark)
    try {
      localStorage.setItem(THEME_MIRROR_KEY, resolvedTheme.value)
    } catch {
      // 隐私模式等 localStorage 不可用时忽略:仅损失下次启动的防闪色能力
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? THEME_META_COLORS.dark : THEME_META_COLORS.light)
    if (isNativePlatform()) {
      void syncNativeStatusBar(dark)
    }
  }

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
    const savedTheme = await localforage.getItem<string>('theme')
    if (savedTheme && (THEME_PREFERENCES as readonly string[]).includes(savedTheme)) {
      theme.value = savedTheme as ThemePreference
    }
    // 监听系统主题变化;store 与页面同生命周期,无需取消监听
    watchSystemTheme((dark) => {
      systemPrefersDark.value = dark
    })
    applyLocale()
    applyTheme()
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

  async function setThemePreference(themePreference: ThemePreference) {
    theme.value = themePreference
    await localforage.setItem('theme', themePreference)
    applyTheme()
  }

  watch(locale, () => {
    applyLocale()
  })

  // 系统主题变化或手动切换时同步应用;applyTheme 内部均为幂等操作
  watch(resolvedTheme, () => {
    applyTheme()
  })

  return {
    locale,
    updateCheckEnabled,
    theme,
    resolvedTheme,
    init,
    setLocalePreference,
    setUpdateCheckEnabled,
    setThemePreference,
  }
})
