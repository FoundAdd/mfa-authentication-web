import { isNativePlatform, loadCapacitorPlugin } from '@/utils/capacitor'
import type {
  BarcodeScannerPlugin,
  BarcodeScannerEvent,
} from '@capacitor-mlkit/barcode-scanning'

export type NativeScanFailure =
  | 'plugin-unavailable'
  | 'permission-denied'
  | 'start-failed'

export class NativeScanError extends Error {
  constructor(
    readonly reason: NativeScanFailure,
    message: string,
  ) {
    super(message)
    this.name = 'NativeScanError'
  }
}

/**
 * 加载 @capacitor-mlkit/barcode-scanning 插件实例。
 * 该插件仅在 Capacitor 原生环境下于 Phase1-07 安装;原生环境之外不加载,
 * 因此这里采用运行时动态加载(specifier 走函数参数,绕过 Vite 静态解析)。
 */
async function loadBarcodeScanner(): Promise<BarcodeScannerPlugin> {
  const mod = await loadCapacitorPlugin<{
    BarcodeScanner?: BarcodeScannerPlugin
  }>('@capacitor-mlkit/barcode-scanning')
  const plugin = mod?.BarcodeScanner
  if (!plugin) throw new NativeScanError('plugin-unavailable', 'mlkit plugin unavailable')
  return plugin
}

async function ensureCameraPermission(
  plugin: BarcodeScannerPlugin,
): Promise<void> {
  try {
    const permission = await plugin.requestPermissions()
    if (permission.camera === 'denied' || permission.camera === 'prompt') {
      throw new NativeScanError('permission-denied', 'camera permission denied')
    }
  } catch (err) {
    if (err instanceof NativeScanError) throw err
    throw new NativeScanError('permission-denied', 'camera permission denied')
  }
}

export function extractBarcodeText(event: BarcodeScannerEvent): string {
  return event.barcode?.rawValue ?? event.barcodeDisplayValue ?? ''
}

export interface TorchState {
  available: boolean
  enabled: boolean
}

/**
 * App 端扫码控制器。封装了 Android 动态权限申请、Google 条形码模块安装、
 * 扫描监听、取景框对外暴露(UI 由 Vue 覆盖层自绘)以及手电筒切换。
 * 扫描状态由调用方持有,组件通过 start/stop 与 torch 方法驱动。
 */
export class NativeScanner {
  private plugin: BarcodeScannerPlugin | null = null
  private listener: { remove: () => void } | null = null

  async start(
    onResult: (text: string, event: BarcodeScannerEvent) => void,
  ): Promise<void> {
    const plugin = await loadBarcodeScanner()
    this.plugin = plugin
    await plugin.installGoogleBarcodeScannerModuleIfNeeded?.()
    await ensureCameraPermission(plugin)

    this.listener = await plugin.addListener('barcodeScanned', (event) => {
      const text = extractBarcodeText(event)
      if (text) onResult(text, event)
    })

    await plugin.startScanning({ cameraDirection: 'back' })
  }

  async stop(): Promise<void> {
    if (this.listener) {
      try {
        this.listener.remove()
      } catch {
        /* 忽略 */
      }
      this.listener = null
    }
    if (this.plugin) {
      try {
        await this.plugin.stopScanning()
      } catch {
        /* 忽略 */
      }
    }
  }

  async torchState(): Promise<TorchState> {
    if (!this.plugin) return { available: false, enabled: false }
    try {
      const { available } = await this.plugin.isTorchAvailable()
      if (!available) return { available: false, enabled: false }
      const { enabled } = await this.plugin.isTorchEnabled()
      return { available: true, enabled }
    } catch {
      return { available: false, enabled: false }
    }
  }

  async setTorch(enabled: boolean): Promise<void> {
    if (!this.plugin) return
    await this.plugin.setTorchMode({ enabled })
  }
}

export function isNativeScannable(): boolean {
  return isNativePlatform()
}
