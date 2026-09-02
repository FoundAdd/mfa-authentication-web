import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import localforage from 'localforage'
import { useSettingStore } from '@/stores/settings'

type ThemeListener = (e: { matches: boolean }) => void

/**
 * 替换 window.matchMedia,使系统 prefers-color-scheme 可控;
 * 返回的 setDark 用于模拟系统在运行期切换主题。
 */
function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<ThemeListener>()
  const mql = {
    matches: initialDark,
    addEventListener: (_: string, cb: ThemeListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: ThemeListener) => listeners.delete(cb),
  }
  const spy = vi
    .spyOn(window, 'matchMedia')
    .mockReturnValue(mql as unknown as MediaQueryList)
  return {
    setDark(dark: boolean) {
      mql.matches = dark
      listeners.forEach((cb) => cb({ matches: dark }))
    },
    restore: () => spy.mockRestore(),
  }
}

let media: ReturnType<typeof stubMatchMedia> | null = null

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await localforage.clear()
})

afterEach(() => {
  media?.restore()
  media = null
  document.documentElement.className = ''
})

describe('settings store theme preference', () => {
  it('defaults to follow-system and applies light theme when system is light', async () => {
    media = stubMatchMedia(false)
    const store = useSettingStore()
    await store.init()

    expect(store.theme).toBe('follow-system')
    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('app-theme')).toBe('light')
  })

  it('follow-system applies dark theme and tracks live system changes', async () => {
    media = stubMatchMedia(true)
    const store = useSettingStore()
    await store.init()

    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('app-theme')).toBe('dark')

    media.setDark(false)
    await nextTick()

    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('app-theme')).toBe('light')
  })

  it('manual dark preference overrides a light system', async () => {
    media = stubMatchMedia(false)
    const store = useSettingStore()
    await store.init()

    await store.setThemePreference('dark')

    expect(store.theme).toBe('dark')
    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('app-theme')).toBe('dark')
    await expect(localforage.getItem('theme')).resolves.toBe('dark')

    // 系统随后切到深色:手动指定不受影响,仍解析为 dark
    media.setDark(true)
    await nextTick()
    expect(store.resolvedTheme).toBe('dark')
  })

  it('manual light preference overrides a dark system', async () => {
    media = stubMatchMedia(true)
    const store = useSettingStore()
    await store.init()

    await store.setThemePreference('light')

    expect(store.resolvedTheme).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('app-theme')).toBe('light')
  })

  it('restores the persisted preference on init', async () => {
    await localforage.setItem('theme', 'dark')
    media = stubMatchMedia(false)
    const store = useSettingStore()
    await store.init()

    expect(store.theme).toBe('dark')
    expect(store.resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('falls back to follow-system when the persisted value is invalid', async () => {
    await localforage.setItem('theme', 'sepia')
    media = stubMatchMedia(false)
    const store = useSettingStore()
    await store.init()

    expect(store.theme).toBe('follow-system')
    expect(store.resolvedTheme).toBe('light')
  })
})
