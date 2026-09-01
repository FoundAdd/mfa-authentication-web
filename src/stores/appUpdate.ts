import { defineStore } from 'pinia'
import { ref } from 'vue'
import localforage from 'localforage'
import {
  checkForUpdate,
  downloadReleaseApk,
  installDownloadedApk,
} from '@/services/appUpdate'
import type { LatestRelease } from '@/services/appUpdate'
import { useSettingStore } from './settings'
import { isNativePlatform } from '@/utils/capacitor'

/** 更新弹窗状态机:idle → downloading → ready(或 error / permission) */
export type UpdatePhase = 'idle' | 'downloading' | 'ready' | 'permission' | 'error'

export type ManualCheckResult = 'updated' | 'latest' | 'error'

const IGNORED_VERSION_KEY = 'update.ignoredVersion'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const update = ref<LatestRelease | null>(null)
  const visible = ref(false)
  const phase = ref<UpdatePhase>('idle')
  const progress = ref(0)

  function show(release: LatestRelease) {
    update.value = release
    phase.value = 'idle'
    progress.value = 0
    visible.value = true
  }

  /**
   * 启动后延迟自动检测新版本;仅在原生环境且用户开启检测时执行,
   * 任何失败都静默处理,不打扰用户。非强制更新,用户可跳过此版本。
   */
  async function autoCheck(delayMs = 3000) {
    if (!isNativePlatform()) return
    const settings = useSettingStore()
    if (!settings.updateCheckEnabled) return
    if (delayMs > 0) await sleep(delayMs)
    // 等待期间用户可能已在设置中关闭更新检测
    if (!settings.updateCheckEnabled) return
    try {
      const release = await checkForUpdate()
      if (!release) return
      const ignored = await localforage.getItem<string>(IGNORED_VERSION_KEY)
      if (release.tagName === ignored) return
      show(release)
    } catch {
      // 自动检测失败不提示
    }
  }

  /** 设置页手动检查,结果用于提示文案;发现新版本时打开更新弹窗 */
  async function manualCheck(): Promise<ManualCheckResult> {
    try {
      const release = await checkForUpdate()
      if (!release) return 'latest'
      show(release)
      return 'updated'
    } catch {
      return 'error'
    }
  }

  async function download() {
    const release = update.value
    if (!release || phase.value === 'downloading') return
    phase.value = 'downloading'
    progress.value = 0
    try {
      await downloadReleaseApk(release, (percent) => {
        progress.value = percent
      })
      phase.value = 'ready'
      // 用户可能在下载期间关掉弹窗,完成后重新打开提示安装
      visible.value = true
    } catch {
      phase.value = 'error'
      visible.value = true
    }
  }

  /** 调起系统安装器;需授予"安装未知应用"权限时切换到 permission 状态引导用户 */
  async function install() {
    const release = update.value
    if (!release || phase.value === 'downloading') return
    try {
      const result = await installDownloadedApk(release)
      if (result === 'permission') {
        phase.value = 'permission'
      } else {
        visible.value = false
        phase.value = 'idle'
      }
    } catch {
      phase.value = 'error'
    }
  }

  /** 跳过此版本:在下一个新版本发布前不再提醒 */
  function skipVersion() {
    if (update.value) {
      void localforage.setItem(IGNORED_VERSION_KEY, update.value.tagName)
    }
    dismiss()
  }

  function dismiss() {
    visible.value = false
    if (phase.value !== 'downloading') {
      phase.value = 'idle'
      progress.value = 0
    }
  }

  return {
    update,
    visible,
    phase,
    progress,
    autoCheck,
    manualCheck,
    download,
    install,
    skipVersion,
    dismiss,
  }
})
