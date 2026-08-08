<template>
  <ResponsiveDialog
    :model-value="modelValue"
    :title="t('settings.title')"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <div class="settings-body">
      <div class="settings-label">{{ t('settings.language') }}</div>
      <el-radio-group
        :model-value="settingStore.locale"
        class="language-options"
        @update:model-value="onLocaleChange"
      >
        <el-radio value="follow-system">
          {{ t('settings.followSystem') }}
        </el-radio>
        <el-radio value="zh-CN">{{ t('settings.zhCN') }}</el-radio>
        <el-radio value="en">{{ t('settings.en') }}</el-radio>
      </el-radio-group>

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
    </div>

    <ExportDialog v-model="exportVisible" />
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Upload, Download } from '@element-plus/icons-vue'
import { useSettingStore } from '@/stores/settings'
import { useTotpStore } from '@/stores/totp'
import type { LocaleType } from '@/locales'
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
const exportVisible = ref(false)

const itemCount = computed(
  () =>
    totpStore.data.ungrouped.length +
    totpStore.data.groups.reduce((sum, g) => sum + g.items.length, 0),
)

function onLocaleChange(value: LocaleType | 'follow-system') {
  void settingStore.setLocalePreference(value)
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

.language-options {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.divider {
  border-top: 1px solid #f0f0f0;
  margin: 4px 0;
}

.import-btn, .export-btn {
  margin-left: 0;
}
</style>