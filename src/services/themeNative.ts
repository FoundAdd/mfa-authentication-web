import { StatusBar, Style } from '@capacitor/status-bar'

/**
 * 将状态栏图标样式与已解析主题同步。
 * Style.Dark 表示深色背景下的浅色图标;只在原生环境调用(由 store 判定)。
 * 状态栏背景保持透明(values/styles.xml),由 WebView 页面背景透出,
 * 因此这里只切换图标样式,不设置背景色。
 */
export async function syncNativeStatusBar(dark: boolean): Promise<void> {
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light })
  } catch {
    // 插件不可用或系统不支持时静默忽略,主题切换不应因此中断
  }
}
