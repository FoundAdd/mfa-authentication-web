import { isNativePlatform } from './capacitor'

export function registerSW() {
  if (isNativePlatform()) return
  // 开发模式下 sw.js 不存在,跳过注册避免浏览器打印
  // 'The script has an unsupported MIME type' 错误
  if (import.meta.env.DEV) return
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 静默处理 */
    })
  }
}