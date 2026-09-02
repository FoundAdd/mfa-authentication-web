<template>
  <ResponsiveDialog
    :model-value="store.visible"
    :title="t('update.newVersion', { version: store.update?.tagName ?? '' })"
    @update:model-value="onVisibleChange"
  >
    <div class="update-body">
      <div class="version-line">
        <span>{{ t('update.currentVersion') }}: v{{ currentVersion || '-' }}</span>
      </div>

      <template v-if="store.update?.notes">
        <div class="notes-label">{{ t('update.releaseNotes') }}</div>
        <div class="notes">{{ store.update.notes }}</div>
      </template>

      <el-progress
        v-if="store.phase === 'downloading'"
        :percentage="store.progress"
      />

      <div v-if="store.phase === 'ready'" class="status">
        {{ t('update.downloadDone') }}
      </div>
      <div v-else-if="store.phase === 'permission'" class="status error">
        {{ t('update.installPermission') }}
      </div>
      <div v-else-if="store.phase === 'error'" class="status error">
        {{ t('update.failed') }}
      </div>
    </div>

    <template #footer>
      <div class="footer-buttons">
        <el-button
          v-if="store.phase !== 'downloading'"
          text
          @click="store.skipVersion()"
        >
          {{ t('update.skip') }}
        </el-button>
        <el-button
          v-if="store.phase !== 'downloading'"
          @click="store.dismiss()"
        >
          {{ t('update.later') }}
        </el-button>
        <el-button
          v-if="store.phase === 'idle' || store.phase === 'error'"
          type="primary"
          @click="store.download()"
        >
          {{ store.phase === 'error' ? t('update.retry') : t('update.updateNow') }}
        </el-button>
        <el-button
          v-if="store.phase === 'ready' || store.phase === 'permission'"
          type="primary"
          @click="store.install()"
        >
          {{ t('update.install') }}
        </el-button>
        <span v-if="store.phase === 'downloading'" class="downloading-text">
          {{ t('update.downloading') }}
        </span>
      </div>
    </template>
  </ResponsiveDialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getInstalledVersion } from '@/services/appUpdate'
import { useAppUpdateStore } from '@/stores/appUpdate'
import ResponsiveDialog from './ResponsiveDialog.vue'

const { t } = useI18n()
const store = useAppUpdateStore()
const currentVersion = ref('')

onMounted(async () => {
  currentVersion.value = await getInstalledVersion()
})

function onVisibleChange(value: boolean) {
  if (!value) store.dismiss()
}
</script>

<style scoped>
.update-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-line {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.notes-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.notes {
  max-height: 200px;
  overflow-y: auto;
  padding: 10px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.status {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.status.error {
  color: var(--el-color-danger);
}

.footer-buttons {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
}

.downloading-text {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
