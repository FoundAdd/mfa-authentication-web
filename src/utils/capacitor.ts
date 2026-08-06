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

/**
 * 运行时动态加载 Capacitor 插件。specifier 以函数参数传入,避免 Vite 在
 * 开发期把字符串常量折叠后当作静态依赖解析(插件在 Phase1-07 才安装,
 * Web 构建环境不存在该模块,必须绕过静态分析)。
 */
export async function loadCapacitorPlugin<T>(
  specifier: string,
): Promise<T | null> {
  try {
    const mod = await import(/* @vite-ignore */ specifier)
    return mod as T
  } catch {
    return null
  }
}