<template>
  <div class="scan-view">
    <div class="scan-topbar">
      <el-button text circle @click="onCancel">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <div class="scan-title">{{ t('scan.title') }}</div>
    </div>

    <div class="scan-body">
      <div v-if="error" class="error-card">
        <el-icon :size="40" color="#f56c6c"><Warning /></el-icon>
        <p class="error-text">{{ error }}</p>
        <el-button type="primary" @click="onErrorConfirm">{{ t('common.confirm') }}</el-button>
      </div>

      <div v-else-if="!scanning && !error && !batchActive" class="init-card">
        <p>{{ t('scan.detecting') }}</p>
      </div>

      <div
        v-show="!error"
        ref="readerContainerRef"
        class="reader-container"
        @touchstart="onReaderTouchStart"
        @touchmove.prevent="onReaderTouchMove"
        @touchend="onReaderTouchEnd"
      >
        <div id="qr-reader" ref="readerRef" />
        <div class="viewfinder-overlay">
          <div class="viewfinder-frame" />
        </div>
      </div>

      <div v-if="batchActive" class="batch-banner">
        <el-progress
          :percentage="batchPercent"
          :stroke-width="6"
          :show-text="false"
          class="batch-progress"
        />
        <p class="batch-text">
          {{ t('scan.batchProgress', { current: batchCollected, total: batchTotal }) }}
        </p>
        <p class="batch-hint">
          {{ batchFromImage ? t('scan.batchNextImage') : t('scan.batchNextCamera') }}
        </p>
      </div>

      <div id="qr-file-scan" class="file-scan-container" />
      <div id="qr-frame-scan" class="file-scan-container" />

      <button type="button" class="image-entry" @click="pickImage">
        <el-icon><Picture /></el-icon>
        <span>{{ t('scan.fromImage') }}</span>
      </button>

      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="file-input"
        @change="onImagePicked"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Picture, Warning } from '@element-plus/icons-vue'
import { WebScanner, WebScanError, scanImageText } from '@/services/webScanner'
import { parseOtpUri, OtpUriError } from '@/services/otpauth-uri'
import {
  parseGaMigrationChunk,
  GaBatchCollector,
  setPendingMigrationAccounts,
  type GaMigrationChunk,
} from '@/services/ga-migration'

const router = useRouter()
const { t } = useI18n()

const scanning = ref(false)
const error = ref('')
const readerRef = ref<HTMLElement | null>(null)
const readerContainerRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const batchActive = ref(false)
const batchCollected = ref(0)
const batchTotal = ref(0)
const batchFromImage = ref(false)

let webScanner: WebScanner | null = null
let batchCollector: GaBatchCollector | null = null

const batchPercent = computed(() =>
  batchTotal.value > 0
    ? Math.round((batchCollected.value / batchTotal.value) * 100)
    : 0,
)

const MAX_ZOOM = 5
let zoomScale = 1
let pinchStartDist = 0
let pinchStartScale = 1

let disposed = true

function getStreamingVideo(): HTMLVideoElement | null {
  return readerContainerRef.value?.querySelector('video') ?? null
}

function pinchDistance(touches: TouchList): number {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  )
}

function onReaderTouchStart(event: TouchEvent) {
  if (event.touches.length !== 2) return
  pinchStartDist = pinchDistance(event.touches)
  pinchStartScale = zoomScale
  const video = getStreamingVideo()
  if (!video) return
  const rect = video.getBoundingClientRect()
  const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left
  const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top
  video.style.transformOrigin = `${(midX / rect.width) * 100}% ${(midY / rect.height) * 100}%`
}

function onReaderTouchMove(event: TouchEvent) {
  if (event.touches.length !== 2) return
  const video = getStreamingVideo()
  if (!video) return
  const next = Math.min(
    MAX_ZOOM,
    Math.max(1, (pinchStartScale * pinchDistance(event.touches)) / (pinchStartDist || 1)),
  )
  zoomScale = next
  video.style.transform = `scale(${next})`
}

function onReaderTouchEnd() {
  pinchStartDist = 0
}

async function stopScanner() {
  if (webScanner) {
    await webScanner.stop()
    webScanner = null
  }
}

function pickImage() {
  const input = fileInputRef.value
  if (input) {
    input.value = ''
    input.click()
  }
}

async function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await stopScanner()
  scanning.value = true
  error.value = ''
  try {
    const text = await scanImageText('qr-file-scan', file)
    if (disposed) return
    handleScannedText(text, 'image')
  } catch {
    error.value = t('scan.fromImageFailed')
  } finally {
    scanning.value = false
  }
}

function handleScannedText(text: string, source: 'camera' | 'image' = 'camera') {
  const raw = text.trim()
  const lower = raw.toLowerCase()
  if (lower.startsWith('otpauth-migration://')) {
    handleMigrationText(raw, source)
    return
  }
  if (!lower.startsWith('otpauth://totp/')) {
    error.value = t('scan.unsupported')
    return
  }
  resetBatch()
  try {
    const parsed = parseOtpUri(raw)
    const params = new URLSearchParams({
      secret: parsed.secret,
      issuer: parsed.issuer,
      label: parsed.label,
      algorithm: parsed.algorithm,
      digits: String(parsed.digits),
      period: String(parsed.period),
    })
    // stop scanner before navigating
    stopScanner()
    router.push(`/add?${params.toString()}`)
  } catch (e) {
    if (e instanceof OtpUriError) {
      error.value = t('scan.unsupported')
    } else {
      error.value = t('scan.unsupported')
    }
  }
}

function handleMigrationText(raw: string, source: 'camera' | 'image') {
  let chunk: GaMigrationChunk
  try {
    chunk = parseGaMigrationChunk(raw)
  } catch {
    error.value = t('scan.unsupported')
    return
  }

  if (chunk.batchSize <= 1) {
    // 单个二维码即可包含全部账号,直接进入预览
    stopScanner()
    router.push({ path: '/migrate', query: { data: raw } })
    return
  }

  // 多二维码分批导出:按 batchIndex 逐个收集,集齐后合并再预览
  if (!batchCollector) batchCollector = new GaBatchCollector()
  const result = batchCollector.add(chunk)
  batchCollected.value = result.collected
  batchTotal.value = result.total
  batchFromImage.value = source === 'image'

  if (result.complete && result.accounts) {
    setPendingMigrationAccounts(result.accounts)
    stopScanner()
    router.push('/migrate')
    return
  }

  batchActive.value = true
}

function resetBatch() {
  batchActive.value = false
  batchCollected.value = 0
  batchTotal.value = 0
  batchFromImage.value = false
  if (batchCollector) {
    batchCollector.reset()
    batchCollector = null
  }
}

async function startScanner() {
  error.value = ''
  resetBatch()
  scanning.value = true
  zoomScale = 1
  disposed = false

  // App 与 Web 统一走 DOM 摄像头(getUserMedia 经 Capacitor Bridge 映射到系统摄像头权限):
  // 自行管理高分辨率视频流并逐帧解码完整画面,以识别大型/高密度二维码。
  if (!readerRef.value) {
    error.value = t('scan.startFailed')
    scanning.value = false
    return
  }
  webScanner = new WebScanner('qr-reader', 'qr-frame-scan', (text) => {
    handleScannedText(text)
  })

  if (!webScanner.isSupported()) {
    error.value = t('scan.insecureContext')
    scanning.value = false
    return
  }

  try {
    await webScanner.start()
  } catch (e) {
    scanning.value = false
    if (e instanceof WebScanError) {
      if (e.reason === 'no-camera') {
        error.value = t('scan.cameraNotFound')
      } else if (e.reason === 'camera-denied') {
        error.value = t('scan.permissionDenied')
      } else if (e.reason === 'not-supported') {
        error.value = t('scan.insecureContext')
      } else {
        error.value = t('scan.startFailed')
      }
    } else {
      error.value = t('scan.startFailed')
    }
  }
}

function onCancel() {
  resetBatch()
  stopScanner()
  router.back()
}

function onErrorConfirm() {
  onCancel()
}

onMounted(() => {
  disposed = false
  startScanner()
})

onUnmounted(() => {
  disposed = true
  resetBatch()
  stopScanner()
})
</script>

<style scoped>
.scan-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #000;
  color: #fff;
}

.scan-topbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 12px 12px;
  gap: 8px;
  color: #fff;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.4), transparent);
}

.scan-topbar :deep(.el-button) {
  color: #fff;
}

.scan-title {
  flex: 1;
  font-size: 17px;
  font-weight: 700;
}

.scan-body {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reader-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
}

#qr-reader {
  width: 100%;
  height: 100%;
}

#qr-reader :deep(video) {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
}

#qr-reader :deep(#qr-shaded-region) {
  display: none !important;
}

.viewfinder-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.viewfinder-frame {
  width: 250px;
  height: 250px;
  border: 2px solid rgba(255, 255, 255, 0.8);
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  transform: translateY(-4.5vh);
}

.error-card {
  text-align: center;
  padding: 24px;
  background: #1a1a1a;
  border-radius: 12px;
  max-width: 320px;
}

.error-card .error-text {
  margin: 16px 0;
  color: #ccc;
  font-size: 14px;
  line-height: 1.6;
}

.init-card {
  text-align: center;
  color: #999;
  font-size: 15px;
}

.batch-banner {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 64px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  width: min(320px, 88vw);
  padding: 16px 18px;
  border-radius: 12px;
  background: rgba(26, 26, 26, 0.92);
  color: #fff;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  text-align: center;
}

.batch-banner .batch-progress {
  margin-bottom: 10px;
}

.batch-banner .batch-text {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
}

.batch-banner .batch-hint {
  margin: 0;
  font-size: 12px;
  color: #bbb;
}

.image-entry {
  position: absolute;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 28px);
  transform: translateX(-50%);
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px;
  border: none;
  border-radius: 999px;
  background: rgba(26, 26, 26, 0.9);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.image-entry:hover {
  background: rgba(58, 58, 58, 0.95);
}

.file-input {
  display: none;
}

.file-scan-container {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
</style>