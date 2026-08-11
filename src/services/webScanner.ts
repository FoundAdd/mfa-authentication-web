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

/** 快速扫描帧的最长边(像素):兼顾常见二维码的响应速度。 */
const QUICK_MAX = 640
/** 深度扫描帧的最长边(像素):保留完整画面细节以识别大型/高密度二维码。 */
const DEEP_MAX = 1920
/** 每 N 帧执行一次深度扫描。 */
const DEEP_EVERY = 4
/** 两帧解码之间的基础间隔(毫秒),解码耗时较长时循环自动让出。 */
const FRAME_INTERVAL_MS = 150

/**
 * 基于 getUserMedia 自管理的 Web 扫码封装。
 * 自行创建高分辨率视频流并逐帧抓取「完整画面」进行解码,避免 html5-qrcode
 * 相机循环中取景框裁剪区域(≤420px)导致的大型二维码识别失败。
 * 解码复用 html5-qrcode 的 scanFile(含多级降采样兜底)。
 */
export class WebScanner {
  private container: HTMLElement | null = null
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private decoder: Html5Qrcode | null = null
  private timer: number | null = null
  private tick = 0
  private disposed = true

  constructor(
    private readonly containerId: string,
    private readonly decodeContainerId: string,
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
    const container = document.getElementById(this.containerId)
    if (!container) {
      throw new WebScanError('start-failed', 'scan container missing')
    }
    this.container = container

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
    } catch (err) {
      throw mapCameraError(err)
    }
    this.stream = stream

    container.innerHTML = ''
    const video = document.createElement('video')
    video.muted = true
    video.setAttribute('muted', 'true')
    video.playsInline = true
    video.autoplay = true
    video.setAttribute('playsinline', 'true')
    video.style.width = '100%'
    video.style.height = '100%'
    video.style.objectFit = 'cover'
    video.srcObject = stream
    container.append(video)
    this.video = video
    try {
      await video.play()
    } catch (err) {
      this.stopStream()
      throw mapCameraError(err)
    }

    this.decoder = new Html5Qrcode(this.decodeContainerId)
    this.disposed = false
    this.tick = 0
    this.scheduleNext()
  }

  async stop(): Promise<void> {
    this.disposed = true
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    this.stopStream()
    if (this.decoder) {
      try {
        this.decoder.clear()
      } catch {
        /* 忽略清理失败 */
      }
      this.decoder = null
    }
    if (this.container) {
      this.container.innerHTML = ''
    }
    this.container = null
    this.video = null
  }

  isScanning(): boolean {
    return !this.disposed && this.stream !== null
  }

  private stopStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }
    if (this.video) {
      this.video.srcObject = null
    }
  }

  private scheduleNext(): void {
    if (this.disposed) return
    this.timer = window.setTimeout(() => {
      void this.scanOnce()
    }, FRAME_INTERVAL_MS)
  }

  private async scanOnce(): Promise<void> {
    const video = this.video
    const decoder = this.decoder
    if (this.disposed || !video || !decoder) return
    if (!video.videoWidth || video.readyState < 2) {
      this.scheduleNext()
      return
    }
    this.tick += 1
    const deep = this.tick % DEEP_EVERY === 0
    try {
      const file = await videoFrameToFile(video, deep ? DEEP_MAX : QUICK_MAX)
      if (this.disposed || !file) {
        this.scheduleNext()
        return
      }
      const text = await decodeFileBestEffort(decoder, file, { withDownscale: deep })
      if (this.disposed) return
      if (text) {
        this.onResult(text)
      }
    } catch {
      /* 单帧解码失败,继续下一帧 */
    }
    this.scheduleNext()
  }
}

/** 图片解码降采样目标(最长边,像素),依次尝试直到解码成功。 */
const DOWNSCALE_TARGETS = [1400, 1024, 720, 512]

type ScannableImageSource = HTMLImageElement | ImageBitmap

async function loadImageSource(file: File): Promise<ScannableImageSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* 回退到 Image 元素解码 */
    }
  }
  return new Promise<ScannableImageSource>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image load failed'))
    }
    img.src = url
  })
}

function drawScaled(source: ScannableImageSource, maxDim: number): HTMLCanvasElement {
  const width = source.width
  const height = source.height
  const longest = Math.max(width, height)
  const scale = Math.min(1, maxDim / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('unable to get 2d context')
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

function canvasToFile(canvas: HTMLCanvasElement): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(new File([blob], 'qr-scan.png', { type: 'image/png' }))
      } else {
        reject(new Error('canvas toBlob failed'))
      }
    }, 'image/png')
  })
}

async function decodeFileBestEffort(
  instance: Html5Qrcode,
  file: File,
  options: { withDownscale?: boolean } = {},
): Promise<string> {
  const { withDownscale = true } = options
  let firstError: unknown
  try {
    return await instance.scanFile(file, false)
  } catch (error) {
    firstError = error
  }
  if (!withDownscale) {
    throw firstError
  }
  try {
    const source = await loadImageSource(file)
    const sourceWidth = source.width
    const sourceHeight = source.height
    for (const target of DOWNSCALE_TARGETS) {
      const canvas = drawScaled(source, target)
      if (canvas.width >= sourceWidth && canvas.height >= sourceHeight) {
        continue
      }
      try {
        const candidate = await canvasToFile(canvas)
        return await instance.scanFile(candidate, false)
      } catch {
        /* 尝试更小尺寸 */
      }
    }
  } catch {
    /* 降采样基础设施不可用,保留原始失败原因 */
  }
  throw firstError
}

/**
 * 从本地图片文件中解码二维码(html5-qrcode scanFile 能力)。
 * 首次按原图分辨率解码,失败后自动降采样重试,以覆盖大分辨率 /
 * 高密度二维码的场景。
 * @param containerId 已挂载且存在于 DOM 的容器元素 id
 * @param file 用户选择的图片文件
 * @returns 解码出的原始文本
 */
export async function scanImageText(containerId: string, file: File): Promise<string> {
  const instance = new Html5Qrcode(containerId)
  try {
    return await decodeFileBestEffort(instance, file)
  } finally {
    try {
      instance.clear()
    } catch {
      /* 忽略清理失败 */
    }
  }
}

/**
 * 将当前摄像头视频帧抓取为可解码的图片文件。
 * 抓取的是视频源的完整画面(而非取景框裁剪区域),按 maxDim 降采样。
 * @param video 正在播放视频流的 video 元素
 * @param maxDim 最长边像素上限
 * @returns 图片文件,无法抓取时返回 null
 */
export function videoFrameToFile(
  video: HTMLVideoElement,
  maxDim: number,
): Promise<File | null> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.resolve(null)
  }
  const longest = Math.max(video.videoWidth, video.videoHeight)
  const scale = Math.min(1, maxDim / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return Promise.resolve(null)
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob ? new File([blob], 'qr-frame.png', { type: 'image/png' }) : null)
      },
      'image/png',
    )
  })
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