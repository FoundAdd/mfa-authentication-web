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
    </div>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useSettingStore } from '@/stores/settings'
import type { LocaleType } from '@/locales'
import ResponsiveDialog from './ResponsiveDialog.vue'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  closed: []
}>()

const { t } = useI18n()
const settingStore = useSettingStore()

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
</style>