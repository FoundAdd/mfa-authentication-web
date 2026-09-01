<template>
  <ResponsiveDialog
    :model-value="modelValue"
    :title="t('settings.title')"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <div class="settings-body">
      <div class="settings-label">{{ t('settings.language') }}</div>
      <el-select
        :model-value="settingStore.locale"
        class="language-select"
        @update:model-value="onLocaleChange"
      >
        <el-option value="follow-system" :label="t('settings.followSystem')" />
        <el-option
          v-for="loc in SUPPORTED_LOCALES"
          :key="loc"
          :value="loc"
          :label="LOCALE_NATIVE_NAMES[loc]"
        />
      </el-select>

      <div class="divider" />

      <div class="settings-label">{{ t('settings.data') }}</div>
      <el-button
        class="import-btn"
        :icon="Upload"
        @click="router.push('/import')"
      >
        {{ t('import.title') }}
      </el-button>
      <el-button
        class="export-btn"
        :icon="Download"
        :disabled="itemCount === 0"
        @click="exportVisible = true"
      >
        {{ t('export.title') }}
      </el-button>

      <template v-if="isNative">
        <div class="divider" />

        <div class="settings-label">{{ t('update.title') }}</div>
        <div class="update-switch">
          <el-switch
            :model-value="settingStore.updateCheckEnabled"
            @update:model-value="onUpdateCheckChange"
          />
          <span>{{ t('update.autoCheck') }}</span>
        </div>
        <div v-if="!settingStore.updateCheckEnabled" class="update-hint">
          {{ t('update.autoCheckHint') }}
        </div>
        <div class="check-row">
          <el-button
            class="check-btn"
            :disabled="!settingStore.updateCheckEnabled"
            :loading="checking"
            @click="onCheckUpdate"
          >
            {{ t('update.checkNow') }}
          </el-button>
          <span v-if="currentVersion" class="version-text">
            v{{ currentVersion }}
          </span>
        </div>
      </template>
    </div>

    <ExportDialog v-model="exportVisible" />
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Upload, Download } from '@element-plus/icons-vue'
import { useSettingStore } from '@/stores/settings'
import { useTotpStore } from '@/stores/totp'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { getInstalledVersion } from '@/services/appUpdate'
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAMES } from '@/locales'
import type { LocalePreference } from '@/locales'
import { isNativePlatform } from '@/utils/capacitor'
import ResponsiveDialog from './ResponsiveDialog.vue'
import ExportDialog from './ExportDialog.vue'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  closed: []
}>()

const router = useRouter()
const { t } = useI18n()
const settingStore = useSettingStore()
const totpStore = useTotpStore()
const appUpdateStore = useAppUpdateStore()
const exportVisible = ref(false)
const checking = ref(false)
const currentVersion = ref('')

// 更新检测仅原生 App 提供
const isNative = isNativePlatform()

const itemCount = computed(
  () =>
    totpStore.data.ungrouped.length +
    totpStore.data.groups.reduce((sum, g) => sum + g.items.length, 0),
)

onMounted(async () => {
  if (isNative) {
    currentVersion.value = await getInstalledVersion()
  }
})

function onLocaleChange(value: LocalePreference) {
  void settingStore.setLocalePreference(value)
}

async function onUpdateCheckChange(value: string | number | boolean) {
  const enabled = Boolean(value)
  await settingStore.setUpdateCheckEnabled(enabled)
  // 关闭更新检测时收起可能打开的更新弹窗
  if (!enabled) appUpdateStore.dismiss()
}

async function onCheckUpdate() {
  checking.value = true
  try {
    const result = await appUpdateStore.manualCheck()
    if (result === 'latest') {
      ElMessage.success(t('update.upToDate'))
    } else if (result === 'error') {
      ElMessage.error(t('update.checkFailed'))
    }
    // 'updated':更新弹窗已由 store 打开
  } finally {
    checking.value = false
  }
}
</script>

<style scoped>
.settings-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.settings-label {
  font-size: 14px;
  color: #606266;
}

.language-select {
  width: 100%;
}

.divider {
  border-top: 1px solid #f0f0f0;
  margin: 4px 0;
}

.import-btn, .export-btn {
  margin-left: 0;
}

.update-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #303133;
}

.update-hint {
  font-size: 12px;
  color: #909399;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.check-btn {
  margin-left: 0;
}

.version-text {
  font-size: 13px;
  color: #909399;
}
</style>