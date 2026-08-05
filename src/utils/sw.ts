import { isNativePlatform } from './capacitor'

export function registerSW() {
  if (isNativePlatform()) {
    return
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed silently
    })
  }
}