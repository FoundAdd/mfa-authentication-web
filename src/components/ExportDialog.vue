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
    <div v-else class="export-body">
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
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="emit('update:modelValue', false)">
          {{ t('common.cancel') }}
        </el-button>
        <el-button
          type="primary"
          :disabled="!canExport"
          :loading="exporting"
          @click="onExport"
        >
          {{ t('export.download') }}
        </el-button>
      </div>
    </template>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useTotpStore } from '@/stores/totp'
import { buildExport, exportFilename } from '@/services/backup'
import { exportTextFile } from '@/services/fileExport'
import ResponsiveDialog from './ResponsiveDialog.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const totpStore = useTotpStore()

const encrypt = ref(false)
const password = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const exporting = ref(false)

const itemCount = computed(
  () =>
    totpStore.data.ungrouped.length +
    totpStore.data.groups.reduce((sum, g) => sum + g.items.length, 0),
)

const passwordOk = computed(
  () => password.value.length > 0 && password.value === confirmPassword.value,
)

const canExport = computed(() => {
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

async function onExport() {
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

function reset() {
  encrypt.value = false
  password.value = ''
  confirmPassword.value = ''
  passwordError.value = ''
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

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-footer :deep(.el-button) {
  margin-left: 0;
}
</style>
