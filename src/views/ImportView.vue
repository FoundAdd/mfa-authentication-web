<template>
  <div class="import-view">
    <div class="topbar">
      <el-button text circle @click="router.back()">
        <el-icon><ArrowLeft /></el-icon>
      </el-button>
      <div class="title">{{ t('import.title') }}</div>
    </div>

    <div v-if="!incoming" class="content">
      <input
        ref="fileInputRef"
        type="file"
        accept=".totp,application/json,text/plain"
        hidden
        @change="onFileChange"
      />
      <div class="dropzone" @click="openFilePicker">
        <el-icon :size="36" class="drop-icon"><Upload /></el-icon>
        <p class="drop-title">{{ t('import.chooseFile') }}</p>
        <span class="drop-hint">{{ t('import.chooseFileHint') }}</span>
      </div>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <template v-if="needsPassword">
        <div class="card">
          <p class="encrypted-hint">{{ t('import.encryptedHint') }}</p>
          <div class="field">
            <label class="field-label">{{ t('import.password') }}</label>
            <el-input
              v-model="password"
              type="password"
              show-password
              :placeholder="t('import.passwordPlaceholder')"
              @keyup.enter="parseFile"
            />
          </div>
          <el-button
            type="primary"
            class="parse-btn"
            :disabled="!password"
            :loading="parsing"
            @click="parseFile"
          >
            {{ t('common.confirm') }}
          </el-button>
        </div>
      </template>
    </div>

    <div v-else class="content">
      <div class="summary">{{ t('import.parsedItems', { count }) }}</div>

      <div class="mode-label">{{ t('import.chooseMode') }}</div>
      <div class="mode-list">
        <div
          class="mode-option"
          :class="{ active: mode === 'merge' }"
          @click="mode = 'merge'"
        >
          <div class="mode-name">{{ t('import.merge') }}</div>
          <div class="mode-desc">{{ t('import.mergeDesc') }}</div>
        </div>
        <div
          class="mode-option"
          :class="{ active: mode === 'overwrite' }"
          @click="mode = 'overwrite'"
        >
          <div class="mode-name">{{ t('import.overwrite') }}</div>
          <div class="mode-desc">{{ t('import.overwriteDesc') }}</div>
        </div>
      </div>

      <el-button type="primary" size="large" class="confirm-btn" @click="confirmImport">
        {{ t('common.confirm') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Upload } from '@element-plus/icons-vue'
import { useTotpStore } from '@/stores/totp'
import {
  readBackup,
  inspectBackup,
  mergeData,
  overwriteData,
} from '@/services/backup'
import { EnvelopeError } from '@/services/crypto'
import type { TotpData } from '@/types'

const router = useRouter()
const { t } = useI18n()
const totpStore = useTotpStore()

const fileInputRef = ref<HTMLInputElement | null>(null)
const serialized = ref('')
const needsPassword = ref(false)
const password = ref('')
const parsing = ref(false)
const error = ref('')
const incoming = ref<TotpData | null>(null)
const mode = ref<'merge' | 'overwrite'>('merge')

function openFilePicker() {
  fileInputRef.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = ''
  password.value = ''
  incoming.value = null
  const text = await file.text()
  if (!text) {
    error.value = t('import.emptyFile')
    input.value = ''
    return
  }
  serialized.value = text
  try {
    const { encrypted } = inspectBackup(text)
    needsPassword.value = encrypted
    if (!encrypted) {
      try {
        incoming.value = await readBackup(text, '')
      } catch {
        error.value = t('import.invalidFile')
        serialized.value = ''
      }
    }
  } catch {
    error.value = t('import.invalidFile')
    serialized.value = ''
  }
}

async function parseFile() {
  if (!password.value) return
  parsing.value = true
  error.value = ''
  try {
    incoming.value = await readBackup(serialized.value, password.value)
  } catch (err) {
    if (err instanceof EnvelopeError && err.reason === 'decrypt-failed') {
      error.value = t('import.wrongPassword')
    } else {
      error.value = t('import.invalidFile')
    }
  } finally {
    parsing.value = false
  }
}

const count = computed(() => {
  if (!incoming.value) return 0
  return (
    incoming.value.ungrouped.length +
    incoming.value.groups.reduce((sum, g) => sum + g.items.length, 0)
  )
})

async function confirmImport() {
  if (!incoming.value) return
  if (mode.value === 'merge') {
    const { result, added, skipped } = mergeData(totpStore.data, incoming.value)
    totpStore.setData(result)
    await totpStore.saveNow()
    ElMessage.success(
      t('import.mergeResult', { added, skipped }),
    )
    router.push('/')
    return
  }

  const existing = totpStore.data.groups.reduce(
    (sum, g) => sum + g.items.length,
    totpStore.data.ungrouped.length,
  )
  try {
    await ElMessageBox.confirm(
      t('import.overwriteConfirm', { count: existing }),
      t('import.overwriteTitle'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      },
    )
  } catch {
    return
  }
  totpStore.setData(overwriteData(incoming.value))
  await totpStore.saveNow()
  ElMessage.success(t('import.overwriteResult', { count: count.value }))
  router.push('/')
}
</script>

<style scoped>
.import-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 12px 12px 32px;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.title {
  font-size: 17px;
  font-weight: 700;
  color: #303133;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #fff;
  border: 1px dashed #dcdfe6;
  border-radius: 10px;
  padding: 36px 16px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.2s;
}

.dropzone:hover {
  border-color: #409eff;
}

.drop-icon {
  color: #909399;
}

.drop-title {
  font-size: 15px;
  color: #303133;
}

.drop-hint {
  font-size: 12px;
  color: #909399;
}

.card {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
}

.encrypted-hint {
  font-size: 13px;
  color: #606266;
  margin-bottom: 16px;
}

.field {
  margin-bottom: 14px;
}

.field-label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.parse-btn {
  width: 100%;
}

.error-msg {
  color: #f56c6c;
  font-size: 13px;
  text-align: center;
}

.summary {
  text-align: center;
  font-size: 15px;
  color: #303133;
  padding: 8px 0;
}

.mode-label {
  font-size: 14px;
  color: #606266;
  margin-bottom: 8px;
}

.mode-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mode-option {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px 16px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.mode-option.active {
  border-color: #409eff;
}

.mode-name {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}

.mode-desc {
  font-size: 13px;
  color: #909399;
}

.confirm-btn {
  width: 100%;
  margin-left: 0;
  margin-top: 4px;
}
</style>