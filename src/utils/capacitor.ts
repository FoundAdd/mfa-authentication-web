let isNative: boolean | null = null

interface CapacitorAPI {
  isNativePlatform: () => boolean
}

export function isNativePlatform(): boolean {
  if (isNative !== null) return isNative
  try {
    const win = window as unknown as { Capacitor?: CapacitorAPI }
    isNative = win.Capacitor?.isNativePlatform?.() === true
  } catch {
    isNative = false
  }
  return isNative
}

export function stubNativePlatform(value: boolean) {
  isNative = value
}

export function resetNativePlatform() {
  isNative = null
}