<template>
  <div class="batch-bar">
    <el-button plain @click="emit('move')">
      {{ t('group.moveToGroup') }}
    </el-button>
    <el-button type="danger" plain @click="emit('delete')">
      {{ t('common.delete') }}
    </el-button>
    <el-button @click="emit('cancel')">
      {{ t('common.cancel') }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  move: []
  'delete': []
  cancel: []
}>()

const { t } = useI18n()
</script>

<style scoped>
.batch-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: var(--el-bg-color);
  border-top: 1px solid var(--el-border-color-lighter);
  z-index: 20;
  box-shadow: var(--app-shadow-bar);
}

.batch-bar :deep(.el-button) {
  flex: 1;
  margin-left: 0;
}
</style>