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
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAMES } from '@/locales'
import type { LocalePreference } from '@/locales'
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

function onLocaleChange(value: LocalePreference) {
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
</style>