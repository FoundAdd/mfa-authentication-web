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

      <div v-else-if="!scanning && !error" class="init-card">
        <p>{{ t('scan.detecting') }}</p>
      </div>

      <div v-show="!error" class="reader-container">
        <div id="qr-reader" ref="readerRef" />
        <div class="viewfinder-overlay">
          <div class="viewfinder-frame" />
        </div>
      </div>

      <div id="qr-file-scan" class="file-scan-container" />

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
import { onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, Picture, Warning } from '@element-plus/icons-vue'
import { WebScanner, WebScanError, scanImageText } from '@/services/webScanner'
import { parseOtpUri, OtpUriError } from '@/services/otpauth-uri'

const router = useRouter()
const { t } = useI18n()

const scanning = ref(false)
const error = ref('')
const readerRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

let webScanner: WebScanner | null = null

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
    handleScannedText(text)
  } catch {
    error.value = t('scan.fromImageFailed')
  } finally {
    scanning.value = false
  }
}

function handleScannedText(text: string) {
  const raw = text.trim()
  const lower = raw.toLowerCase()
  if (lower.startsWith('otpauth-migration://')) {
    stopScanner()
    router.push({
      path: '/migrate',
      query: { data: raw },
    })
    return
  }
  if (!lower.startsWith('otpauth://totp/')) {
    error.value = t('scan.unsupported')
    return
  }
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

async function startScanner() {
  error.value = ''
  scanning.value = true

  // App 与 Web 统一走 DOM 摄像头(html5-qrcode):
  // - WebView 内 getUserMedia 由 Capacitor Bridge 映射到系统摄像头权限,行为与手机浏览器一致
  if (!readerRef.value) {
    error.value = t('scan.startFailed')
    scanning.value = false
    return
  }
  const containerId = 'qr-reader'
  webScanner = new WebScanner(containerId, (text) => {
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
  stopScanner()
  router.back()
}

function onErrorConfirm() {
  onCancel()
}

onMounted(() => {
  startScanner()
})

onUnmounted(() => {
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
}

#qr-reader {
  width: 100%;
  height: 100%;
}

#qr-reader video {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
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