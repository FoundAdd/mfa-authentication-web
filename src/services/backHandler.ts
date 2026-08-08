import { App } from '@capacitor/app'
import { ElMessageBox } from 'element-plus'
import { isNativePlatform } from '@/utils/capacitor'
import router from '@/router'
import { i18n } from '@/locales'

let registered = false
let exitDialogOpen = false

/**
 * Android 返回键处理:
 * - 非首页:返回上一页(与页面顶部返回按钮行为一致)
 * - 首页:弹出退出确认框,确认后调用 App.exitApp()
 * 仅原生环境注册。
 */
export function registerBackHandler() {
  if (!isNativePlatform() || registered) return
  registered = true

  App.addListener('backButton', async () => {
    const route = router.currentRoute.value
    if (route.name !== 'home') {
      router.back()
      return
    }

    // 首页:退出确认
    if (exitDialogOpen) return
    exitDialogOpen = true
    try {
      await ElMessageBox.confirm(
        i18n.global.t('common.exitAppConfirm'),
        i18n.global.t('common.exitApp'),
        {
          confirmButtonText: i18n.global.t('common.exitApp'),
          cancelButtonText: i18n.global.t('common.cancel'),
          type: 'warning',
        },
      )
      await App.exitApp()
    } catch {
      // cancelled
    } finally {
      exitDialogOpen = false
    }
  })
}