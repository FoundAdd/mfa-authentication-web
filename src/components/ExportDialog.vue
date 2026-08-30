<template>
  <ResponsiveDialog
    :model-value="modelValue"
    :title="t('export.title')"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="reset"
  >
    <div v-if="itemCount === 0" class="export-empty">
      {{ t('export.noData') }}
    </div>

    <!-- 二维码展示阶段:逐页展示迁移二维码 -->
    <div v-else-if="mode === 'qr' && qrStep === 'show'" class="export-body qr-stage">
      <div class="qr-box" v-html="qrSvg" />
      <div class="qr-page">
        {{ t('export.qrPage', { current: qrPage + 1, total: qrChunks.length }) }}
      </div>
      <div class="qr-nav">
        <el-button :disabled="qrPage === 0" @click="goToPage(qrPage - 1)">
          {{ t('export.qrPrev') }}
        </el-button>
        <el-button
          :disabled="qrPage === qrChunks.length - 1"
          @click="goToPage(qrPage + 1)"
        >
          {{ t('export.qrNext') }}
        </el-button>
      </div>
      <div class="qr-hint">{{ t('export.qrHint') }}</div>
    </div>

    <!-- 配置阶段 -->
    <div v-else class="export-body">
      <div class="field">
        <label class="field-label">{{ t('export.mode') }}</label>
        <el-radio-group v-model="mode">
          <el-radio value="file">{{ t('export.modeFile') }}</el-radio>
          <el-radio value="qr">{{ t('export.modeQr') }}</el-radio>
        </el-radio-group>
      </div>

      <template v-if="mode === 'file'">
        <el-checkbox v-model="encrypt" class="encrypt-toggle">
          {{ t('export.encryptLabel') }}
        </el-checkbox>

        <template v-if="encrypt">
          <div class="field">
            <label class="field-label">{{ t('export.password') }}</label>
            <el-input
              v-model="password"
              type="password"
              show-password
              :placeholder="t('export.passwordPlaceholder')"
              @input="onPasswordInput"
            />
          </div>
          <div class="field">
            <label class="field-label">{{ t('export.confirmPassword') }}</label>
            <el-input
              v-model="confirmPassword"
              type="password"
              show-password
              :placeholder="t('export.confirmPasswordPlaceholder')"
              @input="onPasswordInput"
            />
          </div>
          <p v-if="passwordError" class="error-text">{{ passwordError }}</p>
        </template>

        <div v-else class="warning-box">
          {{ t('export.plaintextWarning') }}
        </div>
      </template>

      <template v-else>
        <div class="warning-box">{{ t('export.qrPlaintextWarning') }}</div>
        <div v-if="limitWarning" class="warning-box">{{ limitWarning }}</div>
      </template>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <template v-if="mode === 'qr' && qrStep === 'show'">
          <el-button @click="qrStep = 'config'">
            {{ t('export.back') }}
          </el-button>
          <el-button type="primary" @click="emit('update:modelValue', false)">
            {{ t('common.close') }}
          </el-button>
        </template>
        <template v-else>
          <el-button @click="emit('update:modelValue', false)">
            {{ t('common.cancel') }}
          </el-button>
          <el-button
            v-if="mode === 'file'"
            type="primary"
            :disabled="!canExportFile"
            :loading="exporting"
            @click="onExportFile"
          >
            {{ t('export.download') }}
          </el-button>
          <el-button
            v-else
            type="primary"
            :loading="qrGenerating"
            @click="onGenerateQr"
          >
            {{ t('export.generateQr') }}
          </el-button>
        </template>
      </div>
    </template>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import QRCode from 'qrcode'
import { useTotpStore } from '@/stores/totp'
import { buildExport, exportFilename } from '@/services/backup'
import { exportTextFile } from '@/services/fileExport'
import {
  buildGaMigrationChunks,
  countFormatLimitedAccounts,
  toMigrationAccounts,
  type GaExportChunk,
} from '@/services/ga-migration'
import ResponsiveDialog from './ResponsiveDialog.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const totpStore = useTotpStore()

const mode = ref<'file' | 'qr'>('file')
const encrypt = ref(false)
const password = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const exporting = ref(false)

const qrStep = ref<'config' | 'show'>('config')
const qrChunks = ref<GaExportChunk[]>([])
const qrPage = ref(0)
const qrSvg = ref('')
const qrGenerating = ref(false)
// 防止快速翻页时慢一帧的渲染结果覆盖新页面
let qrRenderToken = 0

const itemCount = computed(
  () =>
    totpStore.data.ungrouped.length +
    totpStore.data.groups.reduce((sum, g) => sum + g.items.length, 0),
)

const exportAccounts = computed(() => toMigrationAccounts(totpStore.data))

const limitWarning = computed(() => {
  const limited = countFormatLimitedAccounts(exportAccounts.value)
  return limited > 0 ? t('export.qrLimit', { count: limited }) : ''
})

const passwordOk = computed(
  () => password.value.length > 0 && password.value === confirmPassword.value,
)

const canExportFile = computed(() => {
  if (itemCount.value === 0) return false
  if (encrypt.value) return passwordOk.value
  return true
})

function onPasswordInput() {
  if (password.value !== confirmPassword.value) {
    passwordError.value = t('export.passwordMismatch')
  } else {
    passwordError.value = ''
  }
}

async function onExportFile() {
  if (encrypt.value) {
    if (!passwordOk.value) {
      passwordError.value = t('export.passwordMismatch')
      return
    }
  } else {
    try {
      await ElMessageBox.confirm(
        t('export.plaintextWarning'),
        t('export.download'),
        {
          confirmButtonText: t('common.confirm'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
        },
      )
    } catch {
      return
    }
  }

  exporting.value = true
  try {
    const { json } = await buildExport(
      totpStore.data,
      encrypt.value ? password.value : '',
    )
    const filename = exportFilename()
    const result = await exportTextFile(filename, json)
    ElMessage.success(
      result === 'shared' ? t('export.shared') : t('export.success'),
    )
    emit('update:modelValue', false)
  } catch {
    /* 导出异常:罕见,保持对话框打开供重试 */
  } finally {
    exporting.value = false
  }
}

async function renderQr(uri: string): Promise<string> {
  return QRCode.toString(uri, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  })
}

async function goToPage(index: number) {
  if (index < 0 || index >= qrChunks.value.length) return
  const token = ++qrRenderToken
  const svg = await renderQr(qrChunks.value[index].uri)
  if (token !== qrRenderToken) return
  qrPage.value = index
  qrSvg.value = svg
}

async function onGenerateQr() {
  qrGenerating.value = true
  try {
    qrChunks.value = buildGaMigrationChunks(exportAccounts.value)
    if (qrChunks.value.length === 0) return
    qrRenderToken = 0
    await goToPage(0)
    qrStep.value = 'show'
  } finally {
    qrGenerating.value = false
  }
}

function reset() {
  mode.value = 'file'
  encrypt.value = false
  password.value = ''
  confirmPassword.value = ''
  passwordError.value = ''
  qrStep.value = 'config'
  qrChunks.value = []
  qrPage.value = 0
  qrSvg.value = ''
}
</script>

<style scoped>
.export-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.export-empty {
  color: #909399;
  font-size: 14px;
  padding: 12px 0;
}

.encrypt-toggle {
  font-size: 14px;
}

.field-label {
  display: block;
  font-size: 13px;
  color: #606266;
  margin-bottom: 6px;
}

.error-text {
  color: #f56c6c;
  font-size: 12px;
}

.warning-box {
  background: #fdf6ec;
  border: 1px solid #f3d19e;
  color: #b88230;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
}

.qr-stage {
  align-items: center;
}

.qr-box {
  width: min(260px, 70vw);
  background: #fff;
}

.qr-box :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

.qr-page {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.qr-nav {
  display: flex;
  gap: 12px;
}

.qr-nav :deep(.el-button) {
  margin-left: 0;
}

.qr-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  text-align: center;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-footer :deep(.el-button) {
  margin-left: 0;
}
</style>
