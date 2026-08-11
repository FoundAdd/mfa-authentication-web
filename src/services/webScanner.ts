import { Html5Qrcode } from 'html5-qrcode'

export type WebScanFailure =
  | 'not-supported'
  | 'no-camera'
  | 'camera-denied'
  | 'start-failed'

export class WebScanError extends Error {
  constructor(
    readonly reason: WebScanFailure,
    message: string,
  ) {
    super(message)
    this.name = 'WebScanError'
  }
}

/**
 * 基于 html5-qrcode 的 Web 扫码封装。
 * 调用方需保证容器元素已挂载且页面为 HTTPS/localhost 环境。
 */
export class WebScanner {
  private instance: Html5Qrcode | null = null

  constructor(
    private readonly containerId: string,
    private readonly onResult: (text: string) => void,
  ) {}

  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    )
  }

  async start(): Promise<void> {
    if (!this.isSupported()) {
      throw new WebScanError('not-supported', 'mediaDevices unavailable')
    }
    this.instance = new Html5Qrcode(this.containerId)
    try {
      await this.instance.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: (width, height) => {
            const side = Math.min(width, height) * 0.9
            return { width: Math.min(side, 420), height: Math.min(side, 420) }
          },
        },
        (decoded) => {
          if (decoded) this.onResult(decoded)
        },
        () => {
          /* 忽略逐帧未识别错误 */
        },
      )
    } catch (error) {
      this.instance = null
      throw mapCameraError(error)
    }
  }

  async stop(): Promise<void> {
    if (!this.instance) return
    try {
      await this.instance.stop()
    } catch {
      /* 忽略停止失败 */
    }
    try {
      this.instance.clear()
    } catch {
      /* 忽略清理失败 */
    }
    this.instance = null
  }

  isScanning(): boolean {
    return this.instance !== null
  }
}

/**
 * 从本地图片文件中解码二维码(html5-qrcode scanFile 能力)。
 * 与摄像头扫码使用独立的容器实例,互不干扰。
 * @param containerId 已挂载且存在于 DOM 的容器元素 id
 * @param file 用户选择的图片文件
 * @returns 解码出的原始文本
 */
export async function scanImageText(containerId: string, file: File): Promise<string> {
  const instance = new Html5Qrcode(containerId)
  try {
    return await instance.scanFile(file, false)
  } finally {
    try {
      instance.clear()
    } catch {
      /* 忽略清理失败 */
    }
  }
}

function mapCameraError(err: unknown): WebScanError {
  const name =
    err instanceof Error
      ? err.name
      : typeof err === 'object' && err
        ? (err as { name?: string }).name
        : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return new WebScanError('camera-denied', 'permission denied')
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new WebScanError('no-camera', 'no camera device')
  }
  if (name === 'NotSupportedError') {
    return new WebScanError('not-supported', 'not supported')
  }
  return new WebScanError('start-failed', (err as Error)?.message ?? String(err))
}