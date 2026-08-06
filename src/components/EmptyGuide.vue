<template>
  <div class="empty-guide">
    <div class="empty-icon">
      <el-icon :size="56"><Key /></el-icon>
    </div>
    <h2 class="empty-title">{{ t('guide.title') }}</h2>
    <p class="empty-subtitle">{{ t('guide.subtitle') }}</p>
    <div class="empty-actions">
      <el-button type="primary" size="large" @click="router.push('/scan')">
        {{ t('guide.scan') }}
      </el-button>
      <el-button size="large" @click="router.push('/add')">
        {{ t('guide.manual') }}
      </el-button>
      <el-button size="large" @click="router.push('/import')">
        {{ t('guide.import') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Key } from '@element-plus/icons-vue'

const router = useRouter()
const { t } = useI18n()
</script>

<style scoped>
.empty-guide {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 24px;
  text-align: center;
}

.empty-icon {
  color: #409eff;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 20px;
  color: #303133;
  margin-bottom: 8px;
}

.empty-subtitle {
  font-size: 14px;
  color: #909399;
  margin-bottom: 32px;
  max-width: 320px;
  line-height: 1.6;
}

.empty-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 320px;
}

.empty-actions :deep(.el-button) {
  margin-left: 0;
}
</style>